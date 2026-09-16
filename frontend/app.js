const API = "https://mandi-bhav-api.rajeshsethiyabjp.workers.dev";

const $ = (id) => document.getElementById(id);
const show = (el, yes=true) => el.classList.toggle("hidden", !yes);

async function api(path, options={}) {
  const res = await fetch(API + path, {
    credentials: "include",
    headers: {"content-type":"application/json", ...(options.headers||{})},
    ...options
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderRole(user) {
  $("welcome").textContent = `नमस्ते, ${user.name}`;
  $("roleLabel").textContent = `Role: ${user.role}`;
  show($("adminPanel"), user.role === "SUPER_ADMIN");
  show($("traderPanel"), user.role === "MANDI_TRADER");
  show($("journalistPanel"), user.role === "JOURNALIST");
}

async function boot() {
  try {
    const data = await api("/me", {method:"GET"});
    if (data.user) {
      show($("loginCard"), false);
      show($("app"), true);
      show($("logoutBtn"), true);
      renderRole(data.user);
      if (data.user.role === "SUPER_ADMIN") await loadRoles();
    }
  } catch {}
}

$("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("loginMsg").textContent = "";
  try {
    const data = await api("/api/login", {
      method:"POST",
      body: JSON.stringify({login:$("login").value, password:$("password").value})
    });
    show($("loginCard"), false);
    show($("app"), true);
    show($("logoutBtn"), true);
    renderRole(data.user);
    if (data.user.role === "SUPER_ADMIN") await loadRoles();
  } catch(err) {
    $("loginMsg").textContent = err.message;
  }
});

$("logoutBtn").addEventListener("click", async ()=>{
  await api("/logout",{method:"POST"});
  location.reload();
});

async function loadRoles(){
  const data = await api("/roles");
  $("newRole").innerHTML = data.roles
    .filter(r=>Number(r.is_active))
    .map(r=>`<option value="${r.id}">${r.name}</option>`).join("");
}

$("loadUsers").addEventListener("click", async ()=>{
  const data = await api("/users");
  $("users").innerHTML = data.users.map(u=>`
    <div class="user">
      <div>
        <strong>${escapeHtml(u.name)}</strong>
        <small>${escapeHtml(u.login)} · ${escapeHtml(u.role)}</small>
        <small>${Number(u.is_blocked) ? "🚫 BLOCKED" : "🟢 ACTIVE"}</small>
      </div>
      <button class="${Number(u.is_blocked) ? "" : "danger"}" onclick="toggleUser('${u.id}',${Number(u.is_blocked)})">
        ${Number(u.is_blocked) ? "Unblock" : "Block"}
      </button>
    </div>`).join("");
});

window.toggleUser = async (id, blocked) => {
  await api(`/users/${id}/${blocked ? "unblock":"block"}`, {method:"POST"});
  $("loadUsers").click();
};

$("createUserForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  await api("/users", {
    method:"POST",
    body: JSON.stringify({
      name:$("newName").value,
      login:$("newLogin").value,
      phone:$("newPhone").value,
      password:$("newPassword").value,
      role_id:$("newRole").value
    })
  });
  e.target.reset();
  alert("User बनाया गया");
});

$("createRoleForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  await api("/roles", {
    method:"POST",
    body: JSON.stringify({
      name:$("roleName").value,
      description:$("roleDescription").value
    })
  });
  e.target.reset();
  await loadRoles();
  alert("Role बनाया गया");
});

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

boot();
