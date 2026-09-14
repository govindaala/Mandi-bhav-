import { createClient } from "@libsql/client/web";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra
    }
  });

function cors(env) {
  return {
    "access-control-allow-origin": env.FRONTEND_ORIGIN || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  };
}

function id(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function b64(bytes) {
  let s = "";
  const a = new Uint8Array(bytes);
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}

async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function hashPassword(password, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$120000$${salt}$${b64(bits)}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, iter, salt, expected] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: Number(iter), hash: "SHA-256" },
    key,
    256
  );
  return b64(bits) === expected;
}

function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const item = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

async function db(env) {
  return createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN
  });
}

async function currentUser(request, env) {
  const token = getCookie(request, "mb_session");
  if (!token) return null;
  const hash = await sha256(token);
  const client = await db(env);
  const r = await client.execute({
    sql: `SELECT u.id,u.name,u.login,u.role_id,r.name AS role
          FROM sessions s JOIN users u ON u.id=s.user_id
          JOIN roles r ON r.id=u.role_id
          WHERE s.token_hash=? AND s.expires_at > datetime('now')
            AND u.is_active=1 AND u.is_blocked=0
          LIMIT 1`,
    args: [hash]
  });
  return r.rows[0] || null;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new Response(JSON.stringify({error:"Unauthorized"}), {status:401});
  return user;
}

async function requirePermission(request, env, code) {
  const user = await requireUser(request, env);
  const client = await db(env);
  const r = await client.execute({
    sql: `SELECT 1 FROM role_permissions rp
          JOIN permissions p ON p.id=rp.permission_id
          WHERE rp.role_id=? AND p.code=? LIMIT 1`,
    args: [user.role_id, code]
  });
  if (!r.rows.length) throw new Response(JSON.stringify({error:"Forbidden"}), {status:403});
  return user;
}

async function audit(env, actor, action, entityType, entityId, details = {}) {
  const client = await db(env);
  await client.execute({
    sql: `INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,details_json)
          VALUES(?,?,?,?,?,?)`,
    args: [id("audit"), actor?.id || null, action, entityType, entityId || null, JSON.stringify(details)]
  });
}

async function bootstrap(env) {
  const client = await db(env);
  const count = await client.execute(`SELECT COUNT(*) AS c FROM users`);
  if (Number(count.rows[0].c) > 0) return {created:false};

  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    return {created:false, reason:"bootstrap secrets missing"};
  }

  const passwordHash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  await client.execute({
    sql:`INSERT INTO users(id,name,login,password_hash,role_id)
         VALUES(?,?,?,?,?)`,
    args:[id("usr"),"Super Admin",env.BOOTSTRAP_ADMIN_EMAIL,passwordHash,"role_super_admin"]
  });
  return {created:true};
}

export default {
  async fetch(request, env) {
    const headers = cors(env);

    if (request.method === "OPTIONS") return new Response(null, {headers});

    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        const result = await bootstrap(env);
        return json(result, 200, headers);
      }

      if (url.pathname === "/api/health") return json({ok:true},200,headers);

      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await request.json();
        const login = String(body.login || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!login || !password) return json({error:"Login and password are required"},400,headers);

        const client = await db(env);
        const r = await client.execute({
          sql:`SELECT u.*,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id
               WHERE lower(u.login)=? LIMIT 1`,
          args:[login]
        });
        const u = r.rows[0];
        if (!u || Number(u.is_blocked) || !Number(u.is_active) || !(await verifyPassword(password,u.password_hash))) {
          return json({error:"Invalid login or account blocked"},401,headers);
        }

        const rawToken = b64(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = await sha256(rawToken);
        await client.execute({
          sql:`INSERT INTO sessions(id,user_id,token_hash,expires_at)
               VALUES(?,?,?,datetime('now','+7 days'))`,
          args:[id("sess"),u.id,tokenHash]
        });

        await audit(env,u,"LOGIN","user",u.id);
        const cookie = `mb_session=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
        return json({
          user:{id:u.id,name:u.name,login:u.login,role:u.role}
        },200,{...headers,"set-cookie":cookie});
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        const token = getCookie(request,"mb_session");
        if (token) {
          const client = await db(env);
          await client.execute({sql:"DELETE FROM sessions WHERE token_hash=?",args:[await sha256(token)]});
        }
        return json({ok:true},200,{...headers,"set-cookie":"mb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"});
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        const u = await currentUser(request,env);
        return json({user:u},200,headers);
      }

      if (url.pathname === "/api/users" && request.method === "GET") {
        const actor = await requirePermission(request,env,"users.manage");
        const client = await db(env);
        const r = await client.execute(`SELECT u.id,u.name,u.login,u.phone,u.is_blocked,u.is_active,r.name AS role,u.created_at
                                        FROM users u JOIN roles r ON r.id=u.role_id
                                        ORDER BY u.created_at DESC`);
        await audit(env,actor,"USERS_LIST","user",null);
        return json({users:r.rows},200,headers);
      }

      if (url.pathname === "/api/users" && request.method === "POST") {
        const actor = await requirePermission(request,env,"users.manage");
        const body = await request.json();
        const role = String(body.role_id || "");
        const password = String(body.password || "");
        if (!body.name || !body.login || !role || password.length < 8)
          return json({error:"name, login, role_id and password (8+ chars) required"},400,headers);

        const client = await db(env);
        const exists = await client.execute({sql:"SELECT id FROM roles WHERE id=? AND is_active=1",args:[role]});
        if (!exists.rows.length) return json({error:"Invalid role"},400,headers);

        const uid=id("usr");
        await client.execute({
          sql:`INSERT INTO users(id,name,login,password_hash,role_id,phone) VALUES(?,?,?,?,?,?)`,
          args:[uid,body.name,String(body.login).toLowerCase(),await hashPassword(password),role,body.phone||null]
        });
        await audit(env,actor,"USER_CREATE","user",uid,{role});
        return json({ok:true,id:uid},201,headers);
      }

      const blockMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/(block|unblock)$/);
      if (blockMatch && request.method === "POST") {
        const actor = await requirePermission(request,env,"users.manage");
        const uid=blockMatch[1], action=blockMatch[2];
        if (uid===actor.id && action==="block") return json({error:"You cannot block yourself"},400,headers);
        const client=await db(env);
        await client.execute({sql:"UPDATE users SET is_blocked=?,updated_at=datetime('now') WHERE id=?",
          args:[action==="block"?1:0,uid]});
        await audit(env,actor,action==="block"?"USER_BLOCK":"USER_UNBLOCK","user",uid);
        return json({ok:true},200,headers);
      }

      if (url.pathname === "/api/roles" && request.method === "GET") {
        await requirePermission(request,env,"roles.manage");
        const client=await db(env);
        const r=await client.execute("SELECT * FROM roles ORDER BY name");
        return json({roles:r.rows},200,headers);
      }

      if (url.pathname === "/api/roles" && request.method === "POST") {
        const actor=await requirePermission(request,env,"roles.manage");
        const body=await request.json();
        if (!body.name) return json({error:"Role name required"},400,headers);
        const rid=id("role");
        const client=await db(env);
        await client.execute({
          sql:"INSERT INTO roles(id,name,description,is_system) VALUES(?,?,?,0)",
          args:[rid,String(body.name).toUpperCase(),body.description||null]
        });
        await audit(env,actor,"ROLE_CREATE","role",rid,{name:body.name});
        return json({ok:true,id:rid},201,headers);
      }

      if (url.pathname === "/api/prices" && request.method === "GET") {
        const u=await currentUser(request,env);
        const client=await db(env);
        const commodity=url.searchParams.get("commodity");
        const mandi=url.searchParams.get("mandi");
        const from=url.searchParams.get("from");
        const to=url.searchParams.get("to");
        let sql=`SELECT p.*,m.name AS mandi_name,c.name AS commodity_name,q.name AS quality_name,
                 r.name AS source_role
                 FROM price_records p
                 JOIN mandis m ON m.id=p.mandi_id
                 JOIN commodities c ON c.id=p.commodity_id
                 LEFT JOIN qualities q ON q.id=p.quality_id
                 LEFT JOIN users u ON u.id=p.source_user_id
                 LEFT JOIN roles r ON r.id=u.role_id
                 WHERE p.status='VERIFIED'`;
        const args=[];
        if (commodity){sql+=" AND p.commodity_id=?";args.push(commodity);}
        if (mandi){sql+=" AND p.mandi_id=?";args.push(mandi);}
        if (from){sql+=" AND p.price_date>=?";args.push(from);}
        if (to){sql+=" AND p.price_date<=?";args.push(to);}
        sql+=" ORDER BY p.price_date ASC, p.created_at ASC";
        const r=await client.execute({sql,args});
        return json({prices:r.rows,user:u},200,headers);
      }

      return json({error:"Not found"},404,headers);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error(e);
      return json({error:"Server error"},500,headers);
    }
  }
};
