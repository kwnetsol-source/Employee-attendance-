(() => {
  const $ = (id) => document.getElementById(id);
  const supabaseReady = window.supabase && window.SUPABASE_URL.startsWith("https://") &&
    !window.SUPABASE_URL.includes("YOUR-PROJECT");
  const db = supabaseReady ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;

  let currentUser = null, profile = null, employee = null, activeAttendance = null;
  let gpsWatchId = null, lastUploadAt = 0, map = null, mapMarkers = [];

  const showToast = (message, isError = false) => {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast show ${isError ? "error" : ""}`;
    setTimeout(() => toast.className = "toast", 3500);
  };
  const fmt = (value) => value ? new Date(value).toLocaleString() : "—";
  const time = (value) => value ? new Date(value).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—";
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const setMessage = (id, msg, error=false) => { $(id).textContent = msg; $(id).className = `message ${error ? "error-text" : ""}`; };

  function showApp() {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("todayLabel").textContent = new Date().toLocaleDateString(undefined,{weekday:"short",year:"numeric",month:"short",day:"numeric"});
    $("sidebarName").textContent = profile.full_name || employee?.full_name || currentUser.email;
    $("avatarInitial").textContent = ($("sidebarName").textContent[0] || "U").toUpperCase();
    $("sidebarRole").textContent = profile.role === "manager" ? "Manager" : "Employee";
    $("welcomeTitle").textContent = `Welcome, ${profile.full_name || employee?.full_name || "User"}`;
    document.querySelectorAll(".manager-only").forEach(el => el.classList.toggle("hidden", profile.role !== "manager"));
    $("employeePanel").classList.toggle("hidden", profile.role === "manager");
    $("dutyBadge").classList.toggle("hidden", profile.role === "manager");
    if (profile.role === "manager") loadManagerDashboard();
    else loadEmployeeDashboard();
  }

  async function loadIdentity() {
    const { data: p, error: pe } = await db.from("profiles").select("*").eq("id", currentUser.id).single();
    if (pe) throw pe;
    profile = p;
    const { data: e, error: ee } = await db.from("employees").select("*, departments(department_name)").eq("profile_id", currentUser.id).maybeSingle();
    if (ee) throw ee;
    employee = e;
    if (profile.role === "employee" && !employee) throw new Error("Your employee profile is not linked. Please contact your manager.");
    showApp();
  }

  async function login(event) {
    event.preventDefault();
    if (!db) return setMessage("loginMessage", "Add your Supabase URL and publishable key in config.js first.", true);
    setMessage("loginMessage", "Signing in...");
    const { data, error } = await db.auth.signInWithPassword({email:$("email").value.trim(), password:$("password").value});
    if (error) return setMessage("loginMessage", error.message, true);
    currentUser = data.user;
    try { await loadIdentity(); }
    catch (e) { await db.auth.signOut(); currentUser = null; setMessage("loginMessage", e.message, true); }
  }

  async function logout() {
    stopGps();
    if (db) await db.auth.signOut();
    currentUser = profile = employee = activeAttendance = null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("loginForm").reset();
  }

  async function loadEmployeeDashboard() {
    $("employeeName").textContent = employee.full_name;
    $("employeeCode").textContent = employee.employee_code;
    $("employeeDepartment").textContent = employee.departments?.department_name || "—";
    $("employeeDesignation").textContent = employee.designation || "—";
    const {data, error} = await db.from("attendance").select("*").eq("employee_id", employee.id).is("duty_out", null).maybeSingle();
    if (error) return showToast(error.message, true);
    activeAttendance = data;
    updateDutyUI();
    if (activeAttendance) startGps();
    loadHistory();
  }

  function updateDutyUI() {
    const on = !!activeAttendance;
    $("dutyBadge").textContent = on ? "ON DUTY" : "OFF DUTY";
    $("dutyBadge").className = `badge ${on ? "success" : "neutral"}`;
    $("dutyInBtn").disabled = on;
    $("dutyOutBtn").disabled = !on;
    $("dutyMessage").textContent = on ? `Duty started at ${fmt(activeAttendance.duty_in)}` : "You are currently off duty.";
    $("trackingText").textContent = on ? "GPS tracking active while this page remains active." : "Location tracking is stopped.";
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation is not supported by this device."));
      navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy:true, timeout:20000, maximumAge:0});
    });
  }

  async function dutyIn() {
    try {
      $("dutyInBtn").disabled = true;
      const pos = await getPosition();
      const {data, error} = await db.rpc("duty_in", {p_latitude:pos.coords.latitude, p_longitude:pos.coords.longitude});
      if (error) throw error;
      activeAttendance = {id:data, duty_in:new Date().toISOString()};
      updateDutyUI();
      startGps();
      showToast("Duty In recorded successfully.");
    } catch (e) {
      showToast(e.message || "Could not get GPS location.", true);
      $("dutyInBtn").disabled = false;
    }
  }

  async function uploadPosition(position) {
    if (!activeAttendance || !employee) return;
    const now = Date.now();
    if (now - lastUploadAt < 30000) return;
    lastUploadAt = now;
    const c = position.coords;
    const {error} = await db.rpc("record_location", {
      p_attendance_id:activeAttendance.id,
      p_latitude:c.latitude, p_longitude:c.longitude,
      p_accuracy:c.accuracy ?? null, p_speed:c.speed ?? null, p_heading:c.heading ?? null
    });
    if (error) { showToast(`GPS upload failed: ${error.message}`, true); return; }
    $("lastGps").textContent = new Date().toLocaleTimeString();
  }

  function startGps() {
    if (!activeAttendance || !navigator.geolocation || gpsWatchId !== null) return;
    $("trackingText").textContent = "GPS tracking active while this page remains open.";
    gpsWatchId = navigator.geolocation.watchPosition(uploadPosition,
      err => { $("trackingText").textContent = `GPS issue: ${err.message}`; },
      {enableHighAccuracy:true, maximumAge:0, timeout:25000});
  }
  function stopGps() {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  async function dutyOut() {
    if (!activeAttendance) return;
    try {
      $("dutyOutBtn").disabled = true;
      const pos = await getPosition();
      const {error} = await db.rpc("duty_out", {p_latitude:pos.coords.latitude, p_longitude:pos.coords.longitude});
      if (error) throw error;
      stopGps();
      activeAttendance = null;
      updateDutyUI();
      showToast("Duty Out recorded successfully.");
      loadHistory();
    } catch(e) {
      showToast(e.message || "Could not record Duty Out.", true);
      $("dutyOutBtn").disabled = false;
    }
  }

  async function loadManagerDashboard() {
    const [{data:emps,error:e1},{data:rows,error:e2}] = await Promise.all([
      db.from("employees").select("id,employee_code,full_name,email,is_active,departments(department_name)"),
      db.from("attendance").select("*, employees(full_name,employee_code)").is("duty_out",null)
    ]);
    if (e1 || e2) return showToast((e1||e2).message,true);
    $("statEmployees").textContent = emps.length;
    $("statOnDuty").textContent = rows.length;
    const today = new Date(); today.setHours(0,0,0,0);
    const {count} = await db.from("attendance").select("id",{count:"exact",head:true}).gte("duty_in",today.toISOString());
    $("statPresent").textContent = count ?? "—";
    $("onDutyTable").innerHTML = rows.length ? rows.map(r=>`<tr><td>${escapeHtml(r.employees?.full_name)}</td><td>${escapeHtml(r.employees?.employee_code)}</td><td>${time(r.duty_in)}</td><td><span class="badge success">ON DUTY</span></td></tr>`).join("") : '<tr><td colspan="4" class="empty">No employees currently on duty.</td></tr>';
    loadEmployees();
    loadLocations();
    loadHistory();
  }

  async function loadEmployees() {
    const {data,error} = await db.from("employees").select("*, departments(department_name)").order("full_name");
    if (error) return showToast(error.message,true);
    $("employeesTable").innerHTML = data.length ? data.map(e=>`<tr><td>${escapeHtml(e.full_name)}</td><td>${escapeHtml(e.employee_code)}</td><td>${escapeHtml(e.email)}</td><td>${escapeHtml(e.departments?.department_name||"—")}</td><td>${e.is_active?'<span class="badge success">ACTIVE</span>':'<span class="badge neutral">INACTIVE</span>'}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">No employees found.</td></tr>';
  }

  async function loadLocations() {
    const {data,error} = await db.from("location_logs").select("*, employees(full_name,employee_code)").order("recorded_at",{ascending:false}).limit(500);
    if (error) return showToast(error.message,true);
    const latest = new Map();
    data.forEach(row => { if (!latest.has(row.employee_id)) latest.set(row.employee_id,row); });
    const rows = [...latest.values()];
    $("locationsTable").innerHTML = rows.length ? rows.map(r=>`<tr><td>${escapeHtml(r.employees?.full_name)}</td><td>${fmt(r.recorded_at)}</td><td>${Number(r.latitude).toFixed(6)}</td><td>${Number(r.longitude).toFixed(6)}</td><td>${r.accuracy==null?"—":Math.round(r.accuracy)+" m"}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">No location records received yet.</td></tr>';
    if (!window.L) return;
    if (!map) { map = L.map("map").setView([29.3759,47.9774], 7); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map); }
    mapMarkers.forEach(m=>m.remove()); mapMarkers=[];
    rows.forEach(r=>{
      const marker=L.marker([r.latitude,r.longitude]).addTo(map).bindPopup(`<b>${escapeHtml(r.employees?.full_name||"Employee")}</b><br>${fmt(r.recorded_at)}`);
      mapMarkers.push(marker);
    });
    if (rows.length) map.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.2),{maxZoom:14});
    setTimeout(()=>map.invalidateSize(),100);
  }

  async function loadHistory() {
    const query = db.from("attendance").select("*, employees(full_name,employee_code)").order("duty_in",{ascending:false}).limit(200);
    const {data,error} = profile.role === "manager" ? await query : await query.eq("employee_id",employee.id);
    if (error) return showToast(error.message,true);
    $("historyTable").innerHTML = data.length ? data.map(r=>{
      const hrs = r.total_working_seconds != null ? (r.total_working_seconds/3600).toFixed(2) : "—";
      return `<tr><td>${new Date(r.duty_in).toLocaleDateString()}</td><td>${escapeHtml(r.employees?.full_name||employee?.full_name||"—")}</td><td>${time(r.duty_in)}</td><td>${time(r.duty_out)}</td><td>${hrs}</td><td><span class="badge ${r.duty_out?"neutral":"success"}">${r.status}</span></td></tr>`;
    }).join("") : '<tr><td colspan="6" class="empty">No attendance records found.</td></tr>';
  }

  function navigate(page) {
    document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
    $(`${page}Page`).classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    $("pageTitle").textContent = ({dashboard:"Dashboard",employees:"Employees",locations:"Location Monitor",history:"Attendance History"})[page];
    $("pageEyebrow").textContent = profile.role === "manager" ? "MANAGER WORKSPACE" : "EMPLOYEE WORKSPACE";
    if (page==="locations") loadLocations();
    if (page==="employees") loadEmployees();
    if (page==="history") loadHistory();
    if (page==="dashboard" && profile.role==="manager") loadManagerDashboard();
  }

  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", logout);
  $("dutyInBtn").addEventListener("click", dutyIn);
  $("dutyOutBtn").addEventListener("click", dutyOut);
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
  $("refreshManagerBtn").addEventListener("click",loadManagerDashboard);
  $("refreshEmployeesBtn").addEventListener("click",loadEmployees);
  $("refreshLocationsBtn").addEventListener("click",loadLocations);
  $("refreshHistoryBtn").addEventListener("click",loadHistory);
  setInterval(()=>{$("clockDisplay").textContent=new Date().toLocaleTimeString();},1000);

  if (!db) setMessage("loginMessage","Setup required: edit config.js and add your Supabase project URL and publishable key.",true);
  else db.auth.getSession().then(async ({data})=>{
    if (data.session) {
      currentUser=data.session.user;
      try { await loadIdentity(); } catch(e) { showToast(e.message,true); }
    }
  });
})();
