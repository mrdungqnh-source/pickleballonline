import { supabaseClient } from "./supabase-client.js?v=2";

const STORAGE_KEY = "courtside-demo-v1";
const DEFAULT_CONFIG = { baseExp: 100, difficulty: 1.5, matchFatigue: 0.3, recoveryHours: 4, advancedLevel: 40, skillPointsPerLevel: 1, bodyPointsPerLevel: 1 };
const DEFAULT_STATE = {
  profile: { username: "Minh Anh", role: "player", level: 12, exp: 1120, rewardPoints: 850, cashBalance: 0, skillPoints: 3, bodyPoints: 2, fatigue: 0.3, lastMatchAt: Date.now() - 45 * 60 * 1000 },
  body: { stamina: 15, flexibility: 14, agility: 16 },
  skills: { drive: 18, drop: 14, backhand: 12, dink: 16, flick: 0, roll: 0, volley: 0, lob: 0 },
  inventory: [],
  registered: false,
  config: { ...DEFAULT_CONFIG },
  shopCategory: "Tất cả"
};
const ITEMS = [
  { id: "racket-1", name: "Carbon Rally 01", category: "Vợt", symbol: "◉", points: 520, buff: "+2 Drive · +1 Drop" },
  { id: "shirt-1", name: "Club Jersey / Moss", category: "Áo", symbol: "▱", points: 280, buff: "+1 Thể lực" },
  { id: "shoes-1", name: "Court Sprint Pro", category: "Giày", symbol: "⌁", points: 430, buff: "+2 Khéo léo" },
  { id: "hat-1", name: "Baseline Cap", category: "Mũ", symbol: "⌒", points: 190, buff: "+1 Dẻo dai" },
  { id: "glasses-1", name: "Court Vision", category: "Kính", symbol: "⌑", points: 240, buff: "+1 Backhand" },
  { id: "racket-2", name: "Control Series 02", category: "Vợt", symbol: "◉", points: 700, buff: "+3 Dink · +1 Volley" }
];
const ROUTES = { home: "Tổng quan", training: "Tập luyện", court: "Sân đấu", tournaments: "Giải đấu", shop: "Cửa hàng", admin: "Quản trị" };
let state = loadState();
let toastTimer;
let authUser = null;
let authMode = "signin";
let arenaController = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return { ...structuredClone(DEFAULT_STATE), ...saved, profile: { ...DEFAULT_STATE.profile, ...saved.profile }, config: { ...DEFAULT_CONFIG, ...saved.config }, body: { ...DEFAULT_STATE.body, ...saved.body }, skills: { ...DEFAULT_STATE.skills, ...saved.skills } };
  } catch (error) { console.warn("Could not load demo state", error); }
  return structuredClone(DEFAULT_STATE);
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function effectiveFatigue() { return Date.now() - state.profile.lastMatchAt >= state.config.recoveryHours * 3600000 ? 0 : state.profile.fatigue; }
function expRequired(level = state.profile.level) { return Math.floor(state.config.baseExp * Math.pow(level, state.config.difficulty)); }
function expPercent() { return Math.min(100, Math.round(state.profile.exp / expRequired() * 100)); }
function currentRoute() { return location.hash.replace(/^#\/?/, "") || "home"; }
function fmt(n) { return new Intl.NumberFormat("vi-VN").format(n); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

function render() {
  const route = ROUTES[currentRoute()] ? currentRoute() : "home";
  arenaController?.destroy();
  arenaController = null;
  const authButton = document.querySelector("#auth-button");
  authButton.textContent = authUser ? "Đăng xuất" : "Đăng nhập";
  document.querySelector(".demo-indicator").innerHTML = authUser ? "<i></i> SUPABASE · ONLINE" : "<i></i> BẢN DEMO";
  document.querySelector(".demo-indicator").classList.toggle("connected", Boolean(authUser));
  document.querySelectorAll("[data-route]").forEach((el) => el.classList.toggle("active", el.dataset.route === route));
  document.querySelector("#current-section").textContent = ROUTES[route];
  document.querySelector(".user-mini-copy span").textContent = `Thành viên · Lv.${state.profile.level}`;
  const view = document.querySelector("#view");
  view.innerHTML = ({ home: renderHome, training: renderTraining, court: renderCourt, tournaments: renderTournaments, shop: renderShop, admin: renderAdmin }[route])();
  view.classList.toggle("arena-view", route === "court");
  if (route === "court") arenaController = createArenaController(view);
  if (route === "tournaments") {
    view.querySelector(".bracket").id = "tournament-bracket";
    view.querySelector(".bracket").closest(".panel").querySelector(".status-pill").id = "tournament-bracket-summary";
  }
  if (route === "tournaments") void loadTournamentList(view, authUser);
  if (route === "training") {
    const rewardNote = view.querySelector(".content-grid > .stack:last-child .panel:last-child p:last-child");
    rewardNote.textContent = `Mỗi cấp nhận ${state.config.skillPointsPerLevel} điểm kỹ năng và ${state.config.bodyPointsPerLevel} điểm cơ thể.`;
  }
  if (authUser) {
    if (route !== "court") view.insertAdjacentHTML("afterbegin", '<div class="admin-warning online-notice">Đang xem hồ sơ Supabase thật. Tập luyện và đăng ký giải dùng xử lý phía máy chủ; cửa hàng và phân bổ điểm vẫn là demo.</div>');
    const trainingDescription = view.querySelector(".training-hero p");
    if (trainingDescription) trainingDescription.textContent = "+35 EXP mỗi buổi · tối đa 5 buổi/ngày UTC · lên cấp nhận điểm nâng cấp.";
    view.querySelectorAll('[data-action="body"], [data-action="skill"], [data-action="buy"], [data-action="register"], [data-action="save-config"]').forEach((button) => {
      button.disabled = true;
      button.title = "Chức năng online chưa được bật";
    });
    document.querySelector('[data-action="reset"]').disabled = true;
  } else {
    document.querySelector('[data-action="reset"]').disabled = false;
  }
  view.focus({ preventScroll: true });
}

function renderAuthModal(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  document.querySelector("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><h2 id="auth-title">${isSignup ? "Tạo tài khoản Courtside" : "Đăng nhập Courtside"}</h2><p>${isSignup ? "Tạo hồ sơ người chơi để lưu tiến trình của bạn." : "Đăng nhập để xem hồ sơ Supabase của bạn."}</p><form id="auth-form" class="auth-form">${isSignup ? '<label>Tên người chơi<input name="username" minlength="3" maxlength="24" autocomplete="nickname" required /></label>' : ""}<label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Mật khẩu<input name="password" type="password" minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}" required /></label><button class="primary-button" type="submit">${isSignup ? "Tạo tài khoản" : "Đăng nhập"}</button></form><button class="auth-switch" data-action="auth-toggle">${isSignup ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Tạo tài khoản"}</button><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Đóng</button></div></section></div>`;
}

async function loadCloudProfile(user) {
  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("id, username, role, reward_points, cash_balance, level, current_exp, unspent_skill_points, unspent_body_points")
    .eq("id", user.id)
    .single();
  if (profileError) {
    console.error("Could not load player profile", profileError);
    notify("Đăng nhập được nhưng chưa tải được hồ sơ. Hãy thử tải lại.");
    return;
  }

  const { data: character, error: characterError } = await supabaseClient
    .from("character_stats")
    .select("stamina, flexibility, agility, fatigue_penalty, last_match_at, skills")
    .eq("user_id", user.id)
    .single();
  if (characterError) {
    console.error("Could not load character stats", characterError);
    notify("Không tải được chỉ số nhân vật.");
    return;
  }

  authUser = user;
  state.profile = {
    ...state.profile,
    username: profile.username,
    role: profile.role,
    level: profile.level,
    exp: profile.current_exp,
    rewardPoints: profile.reward_points,
    cashBalance: profile.cash_balance,
    skillPoints: profile.unspent_skill_points,
    bodyPoints: profile.unspent_body_points,
    fatigue: Number(character.fatigue_penalty),
    lastMatchAt: character.last_match_at ? Date.parse(character.last_match_at) : 0
  };
  state.body = { stamina: character.stamina, flexibility: character.flexibility, agility: character.agility };
  state.skills = { ...DEFAULT_STATE.skills, ...character.skills };
  document.querySelector("#modal-root").innerHTML = "";
  render();
  notify(`Đã đăng nhập: ${profile.username}`);
}

async function initializeAuth() {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session?.user && event === "INITIAL_SESSION") {
      window.setTimeout(() => loadCloudProfile(session.user), 0);
    } else if (event === "SIGNED_OUT") {
      authUser = null;
      state = loadState();
      render();
    }
  });
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) await loadCloudProfile(session.user);
}

async function completeOnlineTraining(button) {
  button.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc("complete_training");
    if (error) throw error;

    state.profile.level = data.level;
    state.profile.exp = data.current_exp;
    state.profile.skillPoints = data.unspent_skill_points;
    state.profile.bodyPoints = data.unspent_body_points;
    render();
    notify(data.levels_gained > 0
      ? `+${data.exp_awarded} EXP · lên ${data.levels_gained} cấp!`
      : `Tập luyện hoàn tất · +${data.exp_awarded} EXP (${data.sessions_today}/${data.daily_limit} buổi hôm nay)`);
  } catch (error) {
    button.disabled = false;
    notify(error.message?.includes("Daily training limit reached")
      ? "Bạn đã đạt giới hạn tập luyện hôm nay."
      : "Chưa thể hoàn tất buổi tập. Hãy tải lại và thử lại.");
    console.error("Online training failed", error);
  }
}

function pageHeading(kicker, title, description, button = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
}
function progressMarkup() {
  return `<div class="level-top"><div class="level-badge">${state.profile.level}</div><div><div class="eyebrow">PLAYER RANK</div><div class="level-name">Rising Player</div><div class="level-sub">Còn ${fmt(Math.max(0, expRequired() - state.profile.exp))} EXP đến cấp ${state.profile.level + 1}</div></div></div><div class="progress-line"><span style="width:${expPercent()}%"></span></div><div class="progress-caption"><span>${fmt(state.profile.exp)} EXP</span><span>${fmt(expRequired())} EXP</span></div><div class="point-row"><span>Điểm kỹ năng chờ phân bổ</span><strong>${state.profile.skillPoints}</strong></div><div class="point-row"><span>Điểm cơ thể chờ phân bổ</span><strong>${state.profile.bodyPoints}</strong></div>`;
}
function skillBars() {
  return Object.entries(state.skills).filter(([key]) => key !== "flick" && key !== "roll" && key !== "volley" && key !== "lob").map(([key, value]) => `<div class="skill-row"><span>${key[0].toUpperCase() + key.slice(1)}</span><div class="skill-track"><i style="width:${Math.min(100, value * 3)}%"></i></div><strong>${value}</strong></div>`).join("");
}
function renderHome() {
  const fatigue = effectiveFatigue().toFixed(1);
  const recovery = effectiveFatigue() === 0 ? "Đã hồi phục hoàn toàn" : `Hao hụt ${fatigue} điểm · hồi phục sau ${state.config.recoveryHours} giờ`;
  return `${pageHeading("THỨ SÁU, 06 THÁNG 11", `Sẵn sàng ra sân, ${escapeHtml(state.profile.username)}?`, "Mỗi buổi tập là một bước tiến gần hơn đến bục vô địch.", `<button class="primary-button" data-route="training">＋ Tập luyện</button>`)}
    <div class="content-grid"><div class="stack">
      <section class="hero-panel"><img class="hero-photo" src="https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1400&q=80" alt="Sân thể thao ngoài trời"/><div class="hero-copy"><div class="eyebrow">MÙA GIẢI 04 · OPEN PLAY</div><h1>Trận tiếp theo bắt đầu từ hôm nay.</h1><p>Luyện kỹ năng, xây dựng phong độ và ghi tên mình lên bảng đấu.</p><button class="primary-button" data-route="tournaments">Khám phá giải đấu <span>↗</span></button></div><div class="hero-meta">01 / PLAYER HUB</div></section>
      <section class="panel stats-strip"><div class="stat"><span class="stat-label">Thể lực thực chiến</span><div class="stat-value">${(state.body.stamina - effectiveFatigue()).toFixed(1)}<small>điểm</small></div><span class="stat-note">Cơ bản ${state.body.stamina}</span></div><div class="stat"><span class="stat-label">Dẻo dai</span><div class="stat-value">${(state.body.flexibility - effectiveFatigue()).toFixed(1)}<small>điểm</small></div><span class="stat-note">Cơ bản ${state.body.flexibility}</span></div><div class="stat"><span class="stat-label">Khéo léo</span><div class="stat-value">${(state.body.agility - effectiveFatigue()).toFixed(1)}<small>điểm</small></div><span class="stat-note">Cơ bản ${state.body.agility}</span></div><div class="stat"><span class="stat-label">Phong độ</span><div class="stat-value">${effectiveFatigue() === 0 ? "100" : Math.max(0, Math.round(100 - effectiveFatigue() * 5))}<small>%</small></div><span class="stat-note">${recovery}</span></div></section>
      <section class="panel panel-pad"><div class="panel-heading"><h2>Kỹ năng trên sân</h2><button class="text-link" data-route="training">Nâng cấp kỹ năng ↗</button></div><div class="skill-list">${skillBars()}</div></section>
      <section class="page-section"><div class="section-title"><h2>Giải đấu nổi bật</h2><button class="text-link" data-route="tournaments">Tất cả giải đấu ↗</button></div><div class="panel panel-pad"><div class="match-row"><div class="match-date">12<small>THÁNG 11</small></div><div class="match-copy"><strong>Rookie Rally · Level 10+</strong><span>Vòng loại cá nhân · 24 / 64 vận động viên</span></div><span class="status-pill live">ĐANG MỞ</span></div><div class="match-row"><div class="match-date">18<small>THÁNG 11</small></div><div class="match-copy"><strong>Club Championship · Level 10+</strong><span>Đôi ngẫu nhiên · 16 / 32 đội</span></div><span class="status-pill">SẮP MỞ</span></div></div></section>
    </div><div class="stack"><section class="panel level-card">${progressMarkup()}</section><section class="panel panel-pad"><div class="panel-heading"><h2>Phong độ hiện tại</h2><span class="timer-icon">◷</span></div><div class="training-timer"><div><strong>${effectiveFatigue() === 0 ? "Đã sẵn sàng thi đấu" : "Thời gian hồi phục"}</strong><span>${recovery}</span></div><span class="status-pill ${effectiveFatigue() === 0 ? "live" : ""}">${effectiveFatigue() === 0 ? "READY" : "REST"}</span></div></section><section class="panel panel-pad"><div class="panel-heading"><h2>Ví của bạn</h2><button class="text-link" data-route="shop">Mở cửa hàng ↗</button></div><div class="point-row" style="border:0;padding:0;margin:0 0 12px"><span>Điểm thưởng</span><strong>${fmt(state.profile.rewardPoints)} <small>pts</small></strong></div><div class="point-row" style="margin:0"><span>PickleCoins demo</span><strong>${fmt(state.profile.cashBalance)} <small>PC</small></strong></div></section><section class="panel panel-pad"><div class="panel-heading"><h2>Trang bị đang dùng</h2><button class="text-link" data-route="shop">Thay đổi</button></div><div class="product-row"><div class="timer-icon">◉</div><div class="match-copy"><strong>Club Starter Paddle</strong><span>Vợt · +1 Drive</span></div><span class="status-pill live">ĐANG DÙNG</span></div></section></div></div>`;
}
function renderTraining() {
  const locked = state.profile.level < state.config.advancedLevel;
  return `${pageHeading("PLAYER DEVELOPMENT", "Tập luyện & phát triển", "Tích lũy EXP, phân bổ điểm và tạo lợi thế cho trận đấu tiếp theo.")}
    <div class="stack"><section class="training-hero"><div><div class="eyebrow" style="color:var(--lime)">BUỔI TẬP HÔM NAY</div><h2>Đưa lối chơi lên một tầm mới.</h2><p>Hoàn thành buổi tập nhận 35 EXP. Lên cấp để nhận điểm nâng cấp.</p></div><button class="primary-button" data-action="train">▶ Bắt đầu tập · +35 EXP</button></section>
    <div class="content-grid"><div class="stack"><section class="panel panel-pad"><div class="panel-heading"><h2>Chỉ số cơ thể</h2><span class="status-pill live">${state.profile.bodyPoints} ĐIỂM CÒN LẠI</span></div><div class="body-grid">${Object.entries(state.body).map(([key, value]) => `<div class="body-stat"><div class="body-stat-head"><span>${({ stamina: "Thể lực", flexibility: "Dẻo dai", agility: "Khéo léo" })[key]}</span><button class="allocate-button" data-action="body" data-key="${key}" aria-label="Tăng ${key}" ${state.profile.bodyPoints < 1 ? "disabled" : ""}>+</button></div><strong>${value}</strong><small>Điểm cơ thể cơ bản</small></div>`).join("")}</div></section>
    <section class="panel panel-pad"><div class="panel-heading"><h2>Cây kỹ năng</h2><span class="status-pill live">${state.profile.skillPoints} ĐIỂM CÒN LẠI</span></div><div class="skill-allocation-row"><strong>Drive</strong><small>Ổn định cuối sân</small><strong>${state.skills.drive}</strong><button class="allocate-button" data-action="skill" data-key="drive" aria-label="Tăng Drive">+</button></div>${["drop", "backhand", "dink"].map((key) => `<div class="skill-allocation-row"><strong>${key[0].toUpperCase() + key.slice(1)}</strong><small>${({ drop: "Bỏ nhỏ", backhand: "Trái tay", dink: "Bóng ngắn" })[key]}</small><strong>${state.skills[key]}</strong><button class="allocate-button" data-action="skill" data-key="${key}" aria-label="Tăng ${key}">+</button></div>`).join("")}</section>
    <section class="panel panel-pad ${locked ? "locked" : ""}"><div class="panel-heading"><h2>Kỹ năng chuyên nghiệp</h2><span class="status-pill">MỞ Ở LV.${state.config.advancedLevel}</span></div>${locked ? `<div class="locked-note">Còn ${state.config.advancedLevel - state.profile.level} cấp để mở khóa Flick, Roll, Volley và Lob.</div>` : ""}${["flick", "roll", "volley", "lob"].map((key) => `<div class="skill-allocation-row"><strong>${key[0].toUpperCase() + key.slice(1)}</strong><small>${locked ? "Chưa mở khóa" : "Kỹ năng nâng cao ×1.2"}</small><strong>${state.skills[key]}</strong><button class="allocate-button" data-action="skill" data-key="${key}" ${locked ? "disabled" : ""}>+</button></div>`).join("")}</section></div>
    <div class="stack"><section class="panel level-card">${progressMarkup()}</section><section class="panel panel-pad"><div class="panel-heading"><h2>Hao hụt thể trạng</h2></div><div class="training-timer"><div><strong>${effectiveFatigue().toFixed(1)} điểm tích lũy</strong><span>Mỗi trận đấu cộng ${state.config.matchFatigue} điểm</span></div><span class="timer-icon">◷</span></div><p style="color:#839087;font-size:10px;line-height:1.6;margin:13px 0 0">${effectiveFatigue() === 0 ? "Bạn đã hồi phục hoàn toàn." : `Hồi phục sau ${state.config.recoveryHours} giờ tính từ trận gần nhất.`}</p></section><section class="panel panel-pad"><div class="panel-heading"><h2>Công thức lên cấp</h2></div><p style="font:500 12px var(--font-display);color:#365744">EXP = ${state.config.baseExp} × Level<sup>${state.config.difficulty}</sup></p><p style="font-size:10px;color:#88948c;line-height:1.6;margin:0">Mỗi cấp nhận ${state.config.skillPointsPerLevel || 1} điểm kỹ năng và 1 điểm cơ thể.</p></section></div></div></div>`;
}
function renderTournaments() {
  return `${pageHeading("SEASON 04 · COMPETITIVE PLAY", "Giải đấu", "Đăng ký thi đấu, xây dựng đội hình và chinh phục bảng xếp hạng.")}
    <div class="balance-bar"><span>Hạng hiện tại <strong>Rookie</strong></span><span>Level <strong>${state.profile.level}</strong></span></div>
    <div id="tournament-list" class="tournament-list"><div class="empty-state">Đang tải giải đấu...</div></div>
    <div id="my-match-list"></div>
    <section class="page-section panel panel-pad"><div class="panel-heading"><h2>Lộ trình thi đấu</h2><span class="status-pill">32 ĐÔI · SINGLE ELIMINATION</span></div><div class="bracket"><div class="bracket-round"><strong>VÒNG 1/16</strong><span>32 đội · 16 trận</span></div><div class="bracket-round"><strong>TỨ KẾT</strong><span>8 đội · 4 trận</span></div><div class="bracket-round"><strong>BÁN KẾT</strong><span>4 đội · 2 trận</span></div><div class="bracket-round"><strong>CHUNG KẾT</strong><span>2 đội · 1 trận</span></div></div></section>`;
}

async function loadTournamentList(view, user) {
  const list = view.querySelector("#tournament-list");
  if (!list) return;

  const { data: tournaments, error } = await supabaseClient
    .from("tournaments")
    .select("id, name, level_bracket, max_pairs, matching_type, status, starts_at, bracket_data")
    .in("status", ["open", "in_progress"])
    .order("starts_at", { ascending: true });
  if (!list.isConnected || currentRoute() !== "tournaments") return;
  if (error) {
    list.innerHTML = '<div class="empty-state">Chưa tải được giải đấu. Hãy tải lại trang.</div>';
    console.error("Could not load tournaments", error);
    return;
  }
  if (!tournaments?.length) {
    list.innerHTML = '<div class="panel empty-state">Hiện chưa có giải đấu mở đăng ký.</div>';
    return;
  }

  let entries = [];
  if (user) {
    const { data, error: entriesError } = await supabaseClient
      .from("tournament_entries")
      .select("tournament_id, status")
      .eq("user_id", user.id);
    if (!list.isConnected || currentRoute() !== "tournaments") return;
    if (!entriesError) entries = data || [];
  }

  list.innerHTML = tournaments.map((tournament) => {
    const entry = entries.find((item) => item.tournament_id === tournament.id);
    const registered = entry && entry.status !== "withdrawn";
    const isOpen = tournament.status === "open";
    const capacityPairs = Number(tournament.bracket_data?.capacity_pairs ?? tournament.max_pairs);
    const actualPairs = Number(tournament.bracket_data?.actual_pairs ?? tournament.max_pairs);
    const starts = tournament.starts_at
      ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short" }).format(new Date(tournament.starts_at))
      : "Chưa ấn định";
    const registration = registered
      ? '<span class="status-pill live">ĐÃ ĐĂNG KÝ</span>'
      : isOpen && user
        ? `<button class="dark-button" data-action="register-online" data-key="${tournament.id}">Đăng ký cá nhân</button>`
        : isOpen
          ? '<button class="secondary-button" data-action="auth">Đăng nhập để đăng ký</button>'
          : '<button class="secondary-button" disabled>Đang diễn ra</button>';
    const adminStart = user && state.profile.role === "admin" && isOpen
      ? `<button class="quiet-button admin-start-button" data-action="start-underfilled" data-key="${tournament.id}">Khởi chạy với số đôi hiện có</button>`
      : "";
    return `<section class="panel tournament-card"><div><div class="tourney-kicker">${tournament.matching_type === "random" ? "CÁ NHÂN · GHÉP ĐÔI NGẪU NHIÊN" : "ĐÔI · MỜI BẠN CHƠI"} · LEVEL ${tournament.level_bracket}+</div><h2>${escapeHtml(tournament.name)}</h2><p>${isOpen ? "Đăng ký cá nhân, ghép cặp khi giải bắt đầu hoặc admin khởi chạy sớm." : "Các đôi đấu loại trực tiếp; bye tự động đi tiếp."}</p><div class="tourney-data"><span>Ngày thi đấu<strong>${starts}</strong></span><span>${isOpen ? "Sức chứa" : "Đã ghép"}<strong>${isOpen ? `${capacityPairs * 2} người` : `${actualPairs} đôi`}</strong></span><span>Điều kiện<strong>Level ${tournament.level_bracket}+</strong></span></div></div><div class="tournament-status"><span class="status-pill ${isOpen ? "live" : ""}">${isOpen ? "ĐANG MỞ ĐĂNG KÝ" : "ĐANG DIỄN RA"}</span><br/>${registration}${adminStart}</div></section>`;
  }).join("");
  updateTournamentBracket(view, tournaments);
  if (user) await loadMyTournamentMatches(view, user, tournaments);
}

function updateTournamentBracket(view, tournaments) {
  const active = tournaments.find((tournament) => tournament.status === "in_progress" && tournament.bracket_data?.actual_pairs);
  if (!active) return;
  const mount = view.querySelector("#tournament-bracket");
  const summary = view.querySelector("#tournament-bracket-summary");
  if (!mount || !summary) return;

  const actualPairs = Number(active.bracket_data.actual_pairs);
  const bracketSize = Number(active.bracket_data.bracket_size);
  const rounds = Number(active.bracket_data.rounds);
  const byes = Number(active.bracket_data.byes || 0);
  summary.textContent = `${actualPairs} ĐÔI · ${byes} BYE · ${rounds} VÒNG`;
  mount.innerHTML = Array.from({ length: rounds }, (_, index) => {
    const matchCount = Math.ceil(bracketSize / 2 ** (index + 1));
    const entrants = Math.ceil(actualPairs / 2 ** index);
    const title = matchCount === 1 ? "CHUNG KẾT" : matchCount === 2 ? "BÁN KẾT" : matchCount === 4 ? "TỨ KẾT" : `VÒNG ${index + 1}`;
    const byeNote = index === 0 && byes > 0 ? ` · ${byes} bye` : "";
    return `<div class="bracket-round"><strong>${title}</strong><span>${matchCount} trận · ${entrants} đôi${byeNote}</span></div>`;
  }).join("");
}

async function loadMyTournamentMatches(view, user, tournaments) {
  const mount = view.querySelector("#my-match-list");
  const activeTournaments = tournaments.filter((tournament) => tournament.status === "in_progress");
  if (!mount || !activeTournaments.length) return;

  const { data: teams, error: teamError } = await supabaseClient
    .from("tournament_teams")
    .select("id, tournament_id")
    .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
    .in("tournament_id", activeTournaments.map((tournament) => tournament.id));
  if (!mount.isConnected || currentRoute() !== "tournaments" || teamError || !teams?.length) return;

  const teamIds = new Set(teams.map((team) => team.id));
  const tournamentNames = new Map(activeTournaments.map((tournament) => [tournament.id, tournament.name]));
  const { data: matches, error } = await supabaseClient
    .from("matches")
    .select("id, tournament_id, round_number, match_number, team_a_id, team_b_id, winner_team_id, scheduled_at")
    .in("tournament_id", activeTournaments.map((tournament) => tournament.id))
    .order("round_number", { ascending: true })
    .order("match_number", { ascending: true });
  if (!mount.isConnected || currentRoute() !== "tournaments" || error || !matches?.length) return;

  const mine = matches.filter((match) => teamIds.has(match.team_a_id) || teamIds.has(match.team_b_id));
  const match = mine.find((item) => !item.winner_team_id && item.team_a_id && item.team_b_id)
    || mine.find((item) => !item.winner_team_id);
  if (!match) return;

  const myTeamId = teams.find((team) => team.tournament_id === match.tournament_id)?.id;
  const waiting = !match.team_a_id || !match.team_b_id;
  const scheduledAt = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const canResolve = !waiting && (!scheduledAt || scheduledAt.getTime() <= Date.now());
  const message = waiting
    ? "Đã vào nhánh. Chờ kết quả vòng trước để biết đối thủ."
    : canResolve
      ? "CP và yếu tố phong độ sẽ được tính tại server; kết quả không thể sửa từ trình duyệt."
      : `Trận bắt đầu ${scheduledAt.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}.`;
  mount.innerHTML = `<section class="panel live-match-card"><div><div class="tourney-kicker">${escapeHtml(tournamentNames.get(match.tournament_id) || "TOURNAMENT")}</div><h2>${waiting ? "Đang chờ đối thủ" : `Vòng ${match.round_number} · Trận ${match.match_number}`}</h2><p>${message}</p></div><div class="live-match-action">${waiting ? '<span class="status-pill">CHỜ NHÁNH</span>' : `<button class="dark-button" data-action="resolve-match" data-key="${match.id}" data-my-team="${myTeamId}" ${canResolve ? "" : "disabled"}>${canResolve ? "Phân định kết quả" : "Chưa đến giờ đấu"}</button>`}</div></section>`;
}

async function registerOnlineTournament(tournamentId, button) {
  if (!authUser) return renderAuthModal("signin");
  button.disabled = true;
  const { data, error } = await supabaseClient.rpc("register_for_tournament", { p_tournament_id: tournamentId });
  if (error) {
    button.disabled = false;
    const message = error.message?.includes("below this tournament bracket")
      ? "Level của bạn chưa đủ điều kiện vào giải này."
      : error.message?.includes("Already registered")
        ? "Bạn đã đăng ký giải này rồi."
        : error.message?.includes("registration is full")
          ? "Giải đã đủ người đăng ký."
          : "Chưa thể đăng ký giải. Hãy tải lại và thử lại.";
    notify(message);
    return;
  }
  notify(`Đăng ký thành công · ${data.entries_count}/${data.max_players} người.`);
  await loadTournamentList(document.querySelector("#view"), authUser);
}

async function startUnderfilledTournament(tournamentId, button) {
  button.disabled = true;
  const { data, error } = await supabaseClient.rpc("admin_start_tournament", { p_tournament_id: tournamentId });
  if (error) {
    button.disabled = false;
    notify(error.message?.includes("Admin role required")
      ? "Chỉ admin mới có thể khởi chạy giải."
      : error.message?.includes("even number")
        ? "Số người đăng ký đang lẻ; cần đủ cặp hoàn chỉnh."
        : error.message?.includes("complete pairs")
          ? "Cần ít nhất 2 đôi hoàn chỉnh (4 người)."
          : "Chưa thể khởi chạy giải. Hãy tải lại và thử lại.");
    return;
  }
  notify(`Đã ghép ${data.pairs} đôi · ${data.byes} bye · ${data.rounds} vòng.`);
  await loadTournamentList(document.querySelector("#view"), authUser);
}

async function resolveOnlineMatch(matchId, button) {
  button.disabled = true;
  const { data, error } = await supabaseClient.rpc("resolve_tournament_match", { p_match_id: matchId });
  if (error) {
    button.disabled = false;
    notify(error.message?.includes("not started yet")
      ? "Trận đấu chưa đến giờ bắt đầu."
      : "Chưa thể phân định trận đấu. Hãy tải lại và thử lại.");
    return;
  }
  const won = data.winner_team_id === button.dataset.myTeam;
  notify(`${won ? "Bạn thắng" : "Bạn thua"} · CP ${data.combat_power_a}–${data.combat_power_b}${data.tournament_completed ? " · Giải đã kết thúc" : " · Đội thắng đi tiếp"}`);
  await loadTournamentList(document.querySelector("#view"), authUser);
}
function renderShop() {
  const categories = ["Tất cả", "Vợt", "Áo", "Giày", "Mũ", "Kính"];
  const filtered = ITEMS.filter((item) => state.shopCategory === "Tất cả" || item.category === state.shopCategory);
  return `${pageHeading("COURTSIDE PRO SHOP", "Cửa hàng trang bị", "Trang bị cho lối chơi của bạn bằng điểm thưởng từ hoạt động trong game.")}
    <div class="balance-bar"><span>Điểm thưởng <strong>◆ ${fmt(state.profile.rewardPoints)}</strong></span><span>PickleCoins demo <strong>◉ ${fmt(state.profile.cashBalance)}</strong></span></div><div class="shop-tabs" role="tablist">${categories.map((category) => `<button role="tab" aria-selected="${category === state.shopCategory}" class="shop-tab ${category === state.shopCategory ? "active" : ""}" data-action="category" data-key="${category}">${category}</button>`).join("")}</div>
    <div class="shop-grid">${filtered.map((item) => { const owned = state.inventory.includes(item.id); return `<article class="panel product-card"><div class="product-art"><span class="starter-tag">${item.category.toUpperCase()}</span><span class="product-symbol" aria-hidden="true">${item.symbol}</span></div><div class="product-info"><h3>${item.name}</h3><p>${item.buff}</p><div class="product-bottom"><span class="product-price">◆ ${fmt(item.points)}<small>Điểm thưởng</small></span><button class="dark-button" data-action="buy" data-key="${item.id}" ${owned ? "disabled" : ""}>${owned ? "Đã sở hữu" : "Mua"}</button></div></div></article>`; }).join("")}</div>
    <div class="admin-warning" style="margin-top:16px">Thanh toán tiền thật chưa được bật trong bản demo. Giao dịch nạp tiền cần xác thực webhook và ghi sổ phía server.</div>`;
}
function renderAdmin() {
  return `${pageHeading("CLUB OPERATIONS", "Cấu hình hệ thống", "Điều chỉnh cân bằng game trong môi trường demo.")}
    <div class="admin-grid"><section class="panel panel-pad"><div class="panel-heading"><h2>Cân bằng game</h2><span class="status-pill">DEMO ONLY</span></div>
      ${[["baseExp", "EXP cơ bản", "EXP cần thiết = cơ bản × level^hệ số", "1"], ["difficulty", "Hệ số khó", "Độ cong của đường lên cấp", "0.1"], ["matchFatigue", "Hao hụt mỗi trận", "Điểm trừ cộng dồn cho 3 chỉ số cơ thể", "0.1"], ["recoveryHours", "Giờ hồi phục", "Thời gian hồi phục hoàn toàn", "1"], ["advancedLevel", "Mở kỹ năng nâng cao ở Level", "Level tối thiểu để mở cây chuyên nghiệp", "1"], ["skillPointsPerLevel", "Điểm kỹ năng mỗi cấp", "Phần thưởng khi nhân vật lên cấp", "1"], ["bodyPointsPerLevel", "Điểm cơ thể mỗi cấp", "Phần thưởng khi nhân vật lên cấp", "1"]].map(([key, label, hint, step]) => `<div class="config-row"><label for="cfg-${key}">${label}<small>${hint}</small></label><input id="cfg-${key}" data-config="${key}" type="number" min="0" step="${step}" value="${state.config[key]}" /></div>`).join("")}
      <button class="primary-button" data-action="save-config">Lưu cấu hình</button></section>
      <div class="stack"><section class="panel panel-pad"><div class="panel-heading"><h2>Tình trạng demo</h2></div><div class="point-row" style="margin-top:0"><span>Người chơi cục bộ</span><strong>01</strong></div><div class="point-row"><span>Giải đấu hoạt động</span><strong>02</strong></div><div class="point-row"><span>Vật phẩm cửa hàng</span><strong>${ITEMS.length}</strong></div></section><div class="admin-warning"><strong>Lưu ý bảo mật:</strong> Đây chỉ là bảng cấu hình phía trình duyệt, không có phân quyền quản trị. Bản production phải xác thực role ở server và chỉ cho phép cập nhật qua endpoint quản trị có audit log.</div></div></div>`;
}

function renderCourt() {
  return `${pageHeading("COURTSIDE ARENA · COURT 01", "Sân đấu", "Chạy vào vị trí, đọc hướng bóng và chọn cú đánh để kéo dài rally.", '<span class="arena-offline-tag"><i></i> MÔ PHỎNG OFFLINE</span>')}
    <div class="arena-layout">
      <div class="arena-main">
        <div class="arena-scoreboard">
          <div class="arena-player-score"><span class="arena-player-dot"></span><div><small>PLAYER 01</small><strong>MINH ANH</strong></div><b id="arena-player-score">0</b></div>
          <div class="arena-match-state"><span id="arena-match-label">PRACTICE SESSION</span><strong id="arena-status">SẴN SÀNG RA SÂN</strong><small id="arena-rally">RALLY 00 · BEST 00</small></div>
          <div class="arena-player-score opponent"><b id="arena-opponent-score">0</b><div><small>PLAYER 02</small><strong>ACE BOT</strong></div><span class="arena-opponent-dot"></span></div>
        </div>
        <div class="arena-court-frame">
          <canvas id="pickleball-court" width="1200" height="660" aria-label="Sân pickleball với nhân vật hoạt hình và bóng đang di chuyển"></canvas>
          <div class="arena-live"><i></i><span id="arena-live-label">COURT CAM 01</span><span>● 60 FPS</span></div>
          <div class="arena-start-overlay" id="arena-overlay"><div class="arena-start-mark">01</div><div class="eyebrow">PICKLEBALL SIMULATOR</div><h2 id="arena-overlay-title">Sẵn sàng chưa?</h2><p id="arena-overlay-copy">Chọn chế độ rồi bước vào sân. Điều khiển nhân vật bằng WASD hoặc phím mũi tên.</p><button class="primary-button" data-action="arena-start">▶ Bắt đầu trận</button></div>
        </div>
        <div class="arena-toolbar">
          <div class="arena-segment" role="group" aria-label="Chế độ chơi"><button class="arena-mode active" data-action="arena-mode" data-key="practice">Luyện tập</button><button class="arena-mode" data-action="arena-mode" data-key="match">Đấu thử · 5 điểm</button></div>
          <div class="arena-shot-picker" role="group" aria-label="Chọn cú đánh"><button class="arena-shot active" data-action="arena-shot" data-key="drive"><span>↗</span> Drive</button><button class="arena-shot" data-action="arena-shot" data-key="drop"><span>⌄</span> Drop</button><button class="arena-shot" data-action="arena-shot" data-key="dink"><span>⌁</span> Dink</button></div>
          <button class="arena-reset" data-action="arena-reset" aria-label="Đặt lại trận">↻ <span>Đặt lại</span></button>
        </div>
        <div class="arena-touchbar">
          <div class="arena-dpad" aria-label="Di chuyển nhân vật"><button data-action="arena-move" data-key="up" aria-label="Chạy lên">↑</button><button data-action="arena-move" data-key="left" aria-label="Chạy trái">←</button><button data-action="arena-move" data-key="down" aria-label="Chạy xuống">↓</button><button data-action="arena-move" data-key="right" aria-label="Chạy phải">→</button></div>
          <span class="arena-key-hint">WASD / ↑ ↓ ← → <b>·</b> SPACE để đánh</span>
          <button class="arena-hit-button" data-action="arena-hit"><span>↗</span> Đánh bóng <small>SPACE</small></button>
        </div>
      </div>
      <aside class="arena-rail">
        <div class="arena-rail-heading"><div class="eyebrow">MATCH ANALYTICS</div><span class="arena-dot-live"></span></div>
        <div class="arena-stat-row"><span>Rally hiện tại</span><strong id="arena-stat-rally">00</strong></div>
        <div class="arena-stat-row"><span>Cú đánh chính xác</span><strong id="arena-stat-hits">00</strong></div>
        <div class="arena-stat-row"><span>Best rally</span><strong id="arena-stat-best">00 <small>hits</small></strong></div>
        <div class="arena-energy"><div><span>PHONG ĐỘ</span><strong id="arena-energy-label">100%</strong></div><div class="arena-energy-track"><i id="arena-energy-bar"></i></div><small>Chỉ số mô phỏng · không trừ stamina hồ sơ</small></div>
        <div class="arena-rail-note"><span>✦</span><div><strong>Đọc bóng, chọn thời điểm</strong><p>ACE BOT trả bóng về ngẫu nhiên. Chạy vào bóng trước khi bấm đánh để giữ rally.</p></div></div>
        <div class="arena-simulation-note">ĐẤU THỬ KHÔNG GHI ĐIỂM XẾP HẠNG<br/>Kết quả không ảnh hưởng hồ sơ online.</div>
      </aside>
    </div>`;
}

function createArenaController(view) {
  const canvas = view.querySelector("#pickleball-court");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  const width = 1200;
  const height = 660;
  const keys = new Set();
  const refs = {
    overlay: view.querySelector("#arena-overlay"),
    overlayTitle: view.querySelector("#arena-overlay-title"),
    overlayCopy: view.querySelector("#arena-overlay-copy"),
    status: view.querySelector("#arena-status"),
    modeLabel: view.querySelector("#arena-match-label"),
    playerScore: view.querySelector("#arena-player-score"),
    opponentScore: view.querySelector("#arena-opponent-score"),
    rally: view.querySelector("#arena-rally"),
    rallyStat: view.querySelector("#arena-stat-rally"),
    hits: view.querySelector("#arena-stat-hits"),
    best: view.querySelector("#arena-stat-best"),
    energy: view.querySelector("#arena-energy-label"),
    energyBar: view.querySelector("#arena-energy-bar"),
    liveLabel: view.querySelector("#arena-live-label")
  };
  const arena = {
    mode: "practice",
    running: false,
    score: { player: 0, opponent: 0 },
    rally: 0,
    hits: 0,
    best: 0,
    fatigue: 0,
    shot: "drive",
    player: { x: 880, y: 330, targetX: 880, targetY: 330 },
    opponent: { x: 320, y: 330, targetX: 320, targetY: 330 },
    ball: null,
    serveAt: 0,
    raf: 0,
    lastFrame: performance.now(),
    destroyed: false
  };

  function setStatus(message) { refs.status.textContent = message; }
  function updateStats() {
    refs.playerScore.textContent = arena.score.player;
    refs.opponentScore.textContent = arena.score.opponent;
    refs.rally.textContent = `RALLY ${String(arena.rally).padStart(2, "0")} · BEST ${String(arena.best).padStart(2, "0")}`;
    refs.rallyStat.textContent = String(arena.rally).padStart(2, "0");
    refs.hits.textContent = String(arena.hits).padStart(2, "0");
    refs.best.innerHTML = `${String(arena.best).padStart(2, "0")} <small>hits</small>`;
    const energy = Math.max(42, 100 - arena.fatigue);
    refs.energy.textContent = `${energy}%`;
    refs.energyBar.style.width = `${energy}%`;
    refs.modeLabel.textContent = arena.mode === "practice" ? "PRACTICE SESSION" : "ARCADE MATCH · FIRST TO 5";
    refs.liveLabel.textContent = arena.running ? "RALLY IN PLAY" : "COURT CAM 01";
  }

  function roundRect(x, y, w, h, radius) {
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
  }

  function drawCourt(now) {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#0b211b");
    sky.addColorStop(0.48, "#17372c");
    sky.addColorStop(1, "#0a1c17");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    for (let row = 0; row < 3; row += 1) {
      const y = 24 + row * 22;
      for (let col = 0; col < 54; col += 1) {
        const x = 20 + col * 22 + (row % 2) * 9;
        const pulse = (Math.sin(now * 0.0015 + col * 0.47 + row) + 1) * 0.5;
        context.fillStyle = pulse > 0.91 ? "rgba(215,243,106,.76)" : `rgba(188,214,199,${0.17 + pulse * 0.22})`;
        context.beginPath(); context.arc(x, y, 2.2, 0, Math.PI * 2); context.fill();
      }
    }

    const glow = context.createRadialGradient(600, 330, 40, 600, 330, 580);
    glow.addColorStop(0, "rgba(86,190,135,.19)");
    glow.addColorStop(1, "rgba(86,190,135,0)");
    context.fillStyle = glow;
    context.fillRect(0, 70, width, 560);

    context.save();
    context.shadowColor = "rgba(0,0,0,.4)";
    context.shadowBlur = 28;
    context.shadowOffsetY = 16;
    roundRect(108, 91, 984, 486, 8);
    context.fillStyle = "#123d31";
    context.fill();
    context.restore();

    const court = context.createLinearGradient(110, 110, 1080, 560);
    court.addColorStop(0, "#31977a");
    court.addColorStop(0.5, "#247b68");
    court.addColorStop(1, "#226d5b");
    roundRect(128, 108, 944, 454, 4);
    context.fillStyle = court;
    context.fill();

    context.save();
    context.globalAlpha = 0.13;
    for (let x = 145; x < 1070; x += 38) {
      context.fillStyle = x % 2 ? "#d8f39d" : "#0b4338";
      context.fillRect(x, 109, 19, 452);
    }
    context.restore();

    context.strokeStyle = "rgba(246,255,242,.88)";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeRect(151, 129, 898, 412);
    context.beginPath();
    context.moveTo(600, 129); context.lineTo(600, 541);
    context.moveTo(424, 129); context.lineTo(424, 541);
    context.moveTo(776, 129); context.lineTo(776, 541);
    context.moveTo(151, 335); context.lineTo(424, 335);
    context.moveTo(776, 335); context.lineTo(1049, 335);
    context.stroke();

    context.strokeStyle = "rgba(228,247,218,.75)";
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(600, 126); context.lineTo(600, 545); context.stroke();
    context.fillStyle = "#d7f36a";
    context.fillRect(594, 123, 12, 12); context.fillRect(594, 538, 12, 12);
    context.setLineDash([6, 8]);
    context.strokeStyle = "rgba(12,44,35,.6)";
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(600, 135); context.lineTo(600, 536); context.stroke();
    context.setLineDash([]);

    context.font = "700 10px 'DM Sans', sans-serif";
    context.fillStyle = "rgba(239,255,232,.62)";
    context.fillText("KITCHEN", 454, 157);
    context.fillText("KITCHEN", 684, 157);
    context.save();
    context.translate(454, 524); context.rotate(Math.PI);
    context.fillText("NO VOLLEY ZONE", 0, 0);
    context.restore();
    context.save();
    context.translate(684, 524); context.rotate(Math.PI);
    context.fillText("NO VOLLEY ZONE", 0, 0);
    context.restore();

    context.fillStyle = "rgba(8,28,21,.78)";
    roundRect(430, 42, 340, 35, 17); context.fill();
    context.fillStyle = "#d8f36e";
    context.font = "700 10px 'DM Sans', sans-serif";
    context.textAlign = "center";
    context.fillText("COURTSIDE CLUB  ·  PICKLEBALL OPEN", 600, 64);
    context.textAlign = "start";
  }

  function drawCharacter(x, y, type, now, moving, facing) {
    const phase = now * (moving ? 0.018 : 0.003);
    const stride = moving ? Math.sin(phase) * 14 : Math.sin(phase) * 2;
    const bob = moving ? Math.abs(Math.cos(phase)) * 4 : Math.sin(phase) * 1.5;
    const isPlayer = type === "player";
    const shirt = isPlayer ? "#ff9558" : "#d8f36e";
    const hair = isPlayer ? "#3c2520" : "#202c39";
    const skin = isPlayer ? "#f3c79c" : "#d89d78";

    context.save();
    context.translate(x, y + bob);
    context.scale(facing, 1);
    context.fillStyle = "rgba(5,25,18,.34)";
    context.beginPath(); context.ellipse(0, 25, 30, 11, 0, 0, Math.PI * 2); context.fill();

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#253e39";
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(-7, 9); context.lineTo(-11 + stride, 24);
    context.moveTo(7, 9); context.lineTo(11 - stride, 24);
    context.stroke();
    context.strokeStyle = isPlayer ? "#f9f4e7" : "#deecdf";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(-14 + stride, 24); context.lineTo(-4 + stride, 24);
    context.moveTo(8 - stride, 24); context.lineTo(18 - stride, 24);
    context.stroke();

    context.fillStyle = shirt;
    roundRect(-18, -21, 36, 37, 13); context.fill();
    context.fillStyle = "rgba(255,255,255,.82)";
    roundRect(-4, -18, 8, 24, 4); context.fill();

    context.strokeStyle = skin;
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(-15, -13); context.lineTo(-25 - stride * 0.4, -1);
    context.moveTo(15, -13); context.lineTo(24 + stride * 0.4, -4);
    context.stroke();
    context.fillStyle = skin;
    context.beginPath(); context.arc(24 + stride * 0.4, -4, 5, 0, Math.PI * 2); context.fill();

    context.fillStyle = skin;
    context.beginPath(); context.ellipse(0, -34, 20, 21, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = hair;
    context.beginPath();
    context.moveTo(-19, -35); context.quadraticCurveTo(-22, -58, -3, -58);
    context.quadraticCurveTo(16, -61, 20, -42); context.quadraticCurveTo(8, -49, -2, -44);
    context.quadraticCurveTo(-10, -38, -19, -35); context.fill();
    context.fillStyle = "#24322d";
    context.beginPath(); context.arc(-7, -34, 2, 0, Math.PI * 2); context.arc(7, -34, 2, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#a65d4b";
    context.lineWidth = 1.8;
    context.beginPath(); context.arc(0, -29, 5, 0.1, Math.PI - 0.1); context.stroke();

    context.save();
    context.translate(29, -7);
    context.rotate(-0.4 + Math.sin(phase) * 0.08);
    context.strokeStyle = "#e8ebd1"; context.lineWidth = 4;
    context.beginPath(); context.moveTo(0, 0); context.lineTo(12, -9); context.stroke();
    context.fillStyle = isPlayer ? "#eaf0d0" : "#d6edca";
    context.strokeStyle = isPlayer ? "#ffb17a" : "#b3d683";
    context.lineWidth = 3;
    context.beginPath(); context.ellipse(20, -16, 10, 15, 0.35, 0, Math.PI * 2); context.fill(); context.stroke();
    context.restore();

    context.fillStyle = "rgba(255,255,255,.9)";
    context.font = "700 9px 'DM Sans', sans-serif";
    context.textAlign = "center";
    context.fillText(isPlayer ? "MINH ANH" : "ACE BOT", 0, 48);
    context.restore();
  }

  function drawBall(now) {
    if (!arena.ball) return;
    const ball = arena.ball;
    let x = ball.x;
    let y = ball.y;
    let heightOffset = 0;
    if (ball.phase === "flight") {
      const progress = Math.min(1, (now - ball.started) / ball.duration);
      x = ball.fromX + (ball.toX - ball.fromX) * progress;
      y = ball.fromY + (ball.toY - ball.fromY) * progress;
      heightOffset = Math.sin(progress * Math.PI) * (arena.shot === "drop" ? 32 : 76);
      ball.x = x; ball.y = y;
      ball.trail.push({ x, y: y - heightOffset });
      if (ball.trail.length > 7) ball.trail.shift();
    }

    ball.trail.forEach((point, index) => {
      context.fillStyle = `rgba(226,255,121,${0.05 + index * 0.035})`;
      context.beginPath(); context.arc(point.x, point.y, 3 + index * 0.45, 0, Math.PI * 2); context.fill();
    });
    context.fillStyle = "rgba(5,22,14,.32)";
    context.beginPath(); context.ellipse(x, y + 3, 10, 4, 0, 0, Math.PI * 2); context.fill();
    context.shadowColor = "#dfff78"; context.shadowBlur = 18;
    context.fillStyle = "#e4ff79";
    context.beginPath(); context.arc(x, y - heightOffset, 7, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(47,93,50,.8)"; context.lineWidth = 1;
    context.beginPath(); context.arc(x, y - heightOffset, 4, -0.5, 1.5); context.stroke();
  }

  function draw(now) {
    context.clearRect(0, 0, width, height);
    drawCourt(now);
    const ballTarget = arena.ball?.phase === "flight" ? arena.ball.recipient : null;
    const playerMoving = Math.abs(arena.player.x - arena.player.targetX) + Math.abs(arena.player.y - arena.player.targetY) > 4;
    const opponentMoving = Math.abs(arena.opponent.x - arena.opponent.targetX) + Math.abs(arena.opponent.y - arena.opponent.targetY) > 4;
    if (ballTarget === "player" || arena.ball?.recipient === "player") {
      context.strokeStyle = "rgba(255,236,117,.5)"; context.lineWidth = 2; context.setLineDash([5, 8]);
      context.beginPath(); context.arc(arena.ball.toX, arena.ball.toY, 34 + Math.sin(now * 0.01) * 5, 0, Math.PI * 2); context.stroke(); context.setLineDash([]);
    }
    drawCharacter(arena.opponent.x, arena.opponent.y, "opponent", now, opponentMoving, 1);
    drawCharacter(arena.player.x, arena.player.y, "player", now, playerMoving, -1);
    drawBall(now);
  }

  function launchBall(from, to, recipient, duration) {
    arena.ball = { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, x: from.x, y: from.y, recipient, started: performance.now(), duration, phase: "flight", trail: [] };
    if (recipient === "player") { arena.player.targetX = to.x; arena.player.targetY = to.y; }
    else { arena.opponent.targetX = to.x; arena.opponent.targetY = to.y; }
  }

  function updateScoreLabels() {
    updateStats();
  }

  function showResult(winner) {
    arena.running = false;
    arena.ball = null;
    refs.overlayTitle.textContent = winner === "player" ? "Bạn thắng rally!" : "ACE BOT ghi điểm";
    refs.overlayCopy.textContent = arena.mode === "match" ? "Trận đấu mô phỏng · kết quả không ghi vào hồ sơ online." : `Rally tốt nhất: ${arena.best} cú đánh. Tiếp tục luyện để phá kỷ lục của mình.`;
    refs.overlay.querySelector(".primary-button").textContent = "▶ Chơi tiếp";
    refs.overlay.classList.remove("hidden");
    setStatus(winner === "player" ? "POINT · MINH ANH" : "POINT · ACE BOT");
  }

  function awardPoint(winner) {
    arena.ball = null;
    arena.fatigue = Math.min(58, arena.fatigue + 5);
    if (winner === "player") arena.score.player += 1;
    else arena.score.opponent += 1;
    arena.rally = 0;
    updateScoreLabels();
    if (arena.mode === "match" && (arena.score.player >= 5 || arena.score.opponent >= 5)) {
      showResult(arena.score.player > arena.score.opponent ? "player" : "opponent");
      return;
    }
    setStatus(winner === "player" ? "ĐIỂM CỦA BẠN" : "ĐỐI THỦ GHI ĐIỂM");
    arena.serveAt = performance.now() + 850;
  }

  function hitBall() {
    if (!arena.running || !arena.ball || arena.ball.phase !== "waiting" || arena.ball.recipient !== "player") {
      setStatus(arena.running ? "CHỜ BÓNG ĐẾN VÙNG ĐÁNH" : "BẤM BẮT ĐẦU ĐỂ VÀO SÂN");
      return;
    }
    const distance = Math.hypot(arena.player.x - arena.ball.toX, arena.player.y - arena.ball.toY);
    if (distance > 95) {
      setStatus("CHẠY VÀO VỊ TRÍ BÓNG!");
      return;
    }
    arena.hits += 1;
    arena.rally += 1;
    arena.best = Math.max(arena.best, arena.rally);
    arena.fatigue = Math.min(58, arena.fatigue + 1);
    updateScoreLabels();
    setStatus(`${arena.shot.toUpperCase()} · RALLY ${arena.rally}`);
    const target = { x: 230 + Math.random() * 280, y: 180 + Math.random() * 300 };
    const duration = arena.shot === "drive" ? 760 : arena.shot === "drop" ? 1140 : 980;
    launchBall({ x: arena.player.x, y: arena.player.y - 7 }, target, "opponent", duration);
  }

  function move(direction) {
    const step = 76;
    if (direction === "up") arena.player.targetY -= step;
    if (direction === "down") arena.player.targetY += step;
    if (direction === "left") arena.player.targetX -= step;
    if (direction === "right") arena.player.targetX += step;
    arena.player.targetX = Math.max(655, Math.min(1015, arena.player.targetX));
    arena.player.targetY = Math.max(170, Math.min(500, arena.player.targetY));
  }

  function reset() {
    arena.running = false;
    arena.score = { player: 0, opponent: 0 };
    arena.rally = 0; arena.hits = 0; arena.best = 0; arena.fatigue = 0;
    arena.ball = null; arena.serveAt = 0;
    arena.player = { x: 880, y: 330, targetX: 880, targetY: 330 };
    arena.opponent = { x: 320, y: 330, targetX: 320, targetY: 330 };
    refs.overlayTitle.textContent = "Sẵn sàng chưa?";
    refs.overlayCopy.textContent = "Chọn chế độ rồi bước vào sân. Điều khiển nhân vật bằng WASD hoặc phím mũi tên.";
    refs.overlay.querySelector(".primary-button").textContent = "▶ Bắt đầu trận";
    refs.overlay.classList.remove("hidden");
    setStatus("SẴN SÀNG RA SÂN");
    updateScoreLabels();
  }

  function start() {
    arena.running = true;
    refs.overlay.classList.add("hidden");
    setStatus("GIAO BÓNG · CHUẨN BỊ");
    arena.serveAt = performance.now() + 450;
  }

  function setMode(mode) {
    arena.mode = mode;
    view.querySelectorAll(".arena-mode").forEach((button) => button.classList.toggle("active", button.dataset.key === mode));
    reset();
    refs.overlayCopy.textContent = mode === "practice" ? "Rèn timing và giữ bóng trong sân. Chế độ này không giới hạn điểm." : "Đấu thử đến 5 điểm cùng ACE BOT. Kết quả không ghi vào hồ sơ online.";
    updateStats();
  }

  function onKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
    if (event.key === " " || event.key === "Enter") { hitBall(); return; }
    const key = event.key.toLowerCase();
    if (["arrowup", "w"].includes(key)) keys.add("up");
    if (["arrowdown", "s"].includes(key)) keys.add("down");
    if (["arrowleft", "a"].includes(key)) keys.add("left");
    if (["arrowright", "d"].includes(key)) keys.add("right");
  }
  function onKeyUp(event) {
    const key = event.key.toLowerCase();
    if (["arrowup", "w"].includes(key)) keys.delete("up");
    if (["arrowdown", "s"].includes(key)) keys.delete("down");
    if (["arrowleft", "a"].includes(key)) keys.delete("left");
    if (["arrowright", "d"].includes(key)) keys.delete("right");
  }

  function tick(now) {
    if (arena.destroyed) return;
    const delta = Math.min(0.04, (now - arena.lastFrame) / 1000);
    arena.lastFrame = now;
    const moveX = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    const moveY = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
    arena.player.targetX += moveX * 360 * delta;
    arena.player.targetY += moveY * 360 * delta;
    arena.player.targetX = Math.max(655, Math.min(1015, arena.player.targetX));
    arena.player.targetY = Math.max(170, Math.min(500, arena.player.targetY));
    for (const player of [arena.player, arena.opponent]) {
      player.x += Math.max(-540 * delta, Math.min(540 * delta, player.targetX - player.x));
      player.y += Math.max(-540 * delta, Math.min(540 * delta, player.targetY - player.y));
    }

    if (arena.running && arena.serveAt && now >= arena.serveAt && !arena.ball) {
      arena.serveAt = 0;
      const target = { x: 790 + Math.random() * 205, y: 190 + Math.random() * 290 };
      launchBall({ x: arena.opponent.x, y: arena.opponent.y - 6 }, target, "player", 900 + Math.random() * 280);
      setStatus("BÓNG ĐANG TỚI · CHẠY ĐÓN BÓNG");
    }

    if (arena.ball?.phase === "flight" && now - arena.ball.started >= arena.ball.duration) {
      arena.ball.phase = "waiting";
      arena.ball.arrived = now;
      if (arena.ball.recipient === "player") {
        arena.player.targetX = arena.ball.toX; arena.player.targetY = arena.ball.toY;
        setStatus("BÓNG TRONG TẦM · ĐÁNH NGAY!");
      } else {
        arena.opponent.targetX = arena.ball.toX; arena.opponent.targetY = arena.ball.toY;
      }
    } else if (arena.ball?.phase === "waiting" && arena.ball.recipient === "player" && now - arena.ball.arrived > 1650) {
      awardPoint("opponent");
    } else if (arena.ball?.phase === "waiting" && arena.ball.recipient === "opponent" && now - arena.ball.arrived > 620) {
      if (Math.random() < 0.2) awardPoint("player");
      else {
        const target = { x: 680 + Math.random() * 300, y: 180 + Math.random() * 300 };
        launchBall({ x: arena.opponent.x, y: arena.opponent.y - 6 }, target, "player", 880 + Math.random() * 320);
        setStatus("ACE BOT TRẢ BÓNG · CHẠY!");
      }
    }

    draw(now);
    arena.raf = requestAnimationFrame(tick);
  }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  updateStats();
  arena.raf = requestAnimationFrame(tick);

  return {
    handle(action, key) {
      if (action === "arena-start") start();
      else if (action === "arena-reset") reset();
      else if (action === "arena-mode") setMode(key);
      else if (action === "arena-shot") {
        arena.shot = key;
        view.querySelectorAll(".arena-shot").forEach((button) => button.classList.toggle("active", button.dataset.key === key));
      } else if (action === "arena-hit") hitBall();
      else if (action === "arena-move") move(key);
    },
    destroy() {
      arena.destroyed = true;
      cancelAnimationFrame(arena.raf);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    }
  };
}

function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function addExp(amount) {
  state.profile.exp += amount;
  let levels = 0;
  while (state.profile.exp >= expRequired()) {
    state.profile.exp -= expRequired();
    state.profile.level += 1;
    state.profile.skillPoints += state.config.skillPointsPerLevel;
    state.profile.bodyPoints += state.config.bodyPointsPerLevel;
    levels += 1;
  }
  return levels;
}
function allocate(type, key) {
  if (type === "body") {
    if (state.profile.bodyPoints < 1) return notify("Bạn đã dùng hết điểm cơ thể.");
    state.body[key] += 1;
    state.profile.bodyPoints -= 1;
  } else {
    if (key in { flick: 0, roll: 0, volley: 0, lob: 0 } && state.profile.level < state.config.advancedLevel) return notify("Kỹ năng này chưa được mở khóa.");
    if (state.profile.skillPoints < 1) return notify("Bạn đã dùng hết điểm kỹ năng.");
    state.skills[key] += 1;
    state.profile.skillPoints -= 1;
  }
  saveState(); render(); notify("Đã phân bổ điểm.");
}
function confirmModal(title, message, confirmLabel, onConfirm) {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><h2>${title}</h2><p>${message}</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Hủy</button><button class="primary-button" data-action="confirm-reset">${confirmLabel}</button></div></section></div>`;
  root.querySelector("[data-action=confirm-reset]").addEventListener("click", () => { onConfirm(); root.innerHTML = ""; });
}

document.addEventListener("click", (event) => {
  const routeLink = event.target.closest("[data-route]");
  if (routeLink) { location.hash = routeLink.dataset.route; return; }
  const control = event.target.closest("[data-action]");
  if (!control) return;
  if (control.classList.contains("modal-backdrop") && control !== event.target) return;
  const { action, key } = control.dataset;
  if (action === "auth") {
    if (authUser) {
      supabaseClient.auth.signOut().then(({ error }) => {
        if (error) notify("Không thể đăng xuất. Hãy thử lại.");
      });
    } else renderAuthModal("signin");
  } else if (action === "auth-toggle") {
    renderAuthModal(authMode === "signin" ? "signup" : "signin");
  } else if (action === "register-online") {
    void registerOnlineTournament(key, control);
  } else if (action === "start-underfilled") {
    void startUnderfilledTournament(key, control);
  } else if (action === "resolve-match") {
    void resolveOnlineMatch(key, control);
  } else if (action.startsWith("arena-")) {
    arenaController?.handle(action, key);
  } else if (action === "train") {
    if (authUser) {
      void completeOnlineTraining(control);
      return;
    }
    const levels = addExp(35);
    saveState(); render();
    notify(levels ? `Tập luyện hoàn tất · lên ${levels} cấp!` : "Tập luyện hoàn tất · +35 EXP");
  } else if (action === "body" || action === "skill") allocate(action, key);
  else if (action === "category") { state.shopCategory = key; render(); }
  else if (action === "buy") {
    const item = ITEMS.find((entry) => entry.id === key);
    if (!item || state.inventory.includes(item.id)) return;
    if (state.profile.rewardPoints < item.points) return notify("Bạn chưa đủ điểm thưởng.");
    state.profile.rewardPoints -= item.points;
    state.inventory.push(item.id);
    saveState(); render(); notify(`Đã mua ${item.name}.`);
  } else if (action === "register") {
    if (state.registered) return;
    state.registered = true; saveState(); render(); notify("Đã đăng ký Rookie Rally (demo).");
  } else if (action === "save-config") {
    document.querySelectorAll("[data-config]").forEach((input) => {
      const value = Number(input.value);
      const permitsZero = ["skillPointsPerLevel", "bodyPointsPerLevel", "matchFatigue"].includes(input.dataset.config);
      if (Number.isFinite(value) && (permitsZero ? value >= 0 : value > 0)) state.config[input.dataset.config] = value;
    });
    saveState(); render(); notify("Đã lưu cấu hình demo.");
  } else if (action === "reset") {
    confirmModal("Khôi phục demo?", "Dữ liệu hiện tại trên trình duyệt sẽ được thay bằng trạng thái mẫu ban đầu.", "Khôi phục", () => {
      state = structuredClone(DEFAULT_STATE); saveState(); render(); notify("Đã khôi phục dữ liệu demo.");
    });
  } else if (action === "close-modal") document.querySelector("#modal-root").innerHTML = "";
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "auth-form") return;
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  const email = String(values.get("email")).trim();
  const password = String(values.get("password"));
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    if (authMode === "signup") {
      const username = String(values.get("username")).trim();
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          emailRedirectTo: `${location.origin}${location.pathname}`
        }
      });
      if (error) throw error;
      if (data.session && data.user) await loadCloudProfile(data.user);
      else document.querySelector("#modal-root").innerHTML = '<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><h2>Kiểm tra email</h2><p>Supabase đã gửi thư xác nhận. Mở liên kết trong email để kích hoạt tài khoản, sau đó đăng nhập tại đây.</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">Đã hiểu</button></div></section></div>';
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await loadCloudProfile(data.user);
    }
  } catch (error) {
    const message = error.message?.toLowerCase().includes("invalid login credentials")
      ? "Email hoặc mật khẩu chưa đúng."
      : error.message?.toLowerCase().includes("redirect")
        ? "URL xác nhận chưa được cho phép trong Supabase Auth URL Configuration."
        : "Không thể xác thực tài khoản. Hãy kiểm tra thông tin và thử lại.";
    notify(message);
    submitButton.disabled = false;
  }
});

window.addEventListener("hashchange", render);
render();
initializeAuth().catch((error) => {
  console.error("Could not initialize Supabase Auth", error);
  notify("Không kết nối được Supabase. Tạm thời đang ở chế độ demo.");
});