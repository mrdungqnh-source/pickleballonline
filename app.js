const supabaseClient = window.courtsideSupabase;
const STORAGE_KEY = "courtside-demo-v1";
const DEFAULT_CONFIG = { baseExp: 100, difficulty: 1.5, matchFatigue: 0.3, recoveryHours: 4, advancedLevel: 40, skillPointsPerLevel: 1, bodyPointsPerLevel: 1 };
const DEFAULT_STATE = {
  profile: { username: "Minh Anh", level: 12, exp: 1120, rewardPoints: 850, cashBalance: 0, skillPoints: 3, bodyPoints: 2, fatigue: 0.3, lastMatchAt: Date.now() - 45 * 60 * 1000 },
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
const ROUTES = { home: "Tổng quan", training: "Tập luyện", tournaments: "Giải đấu", shop: "Cửa hàng", admin: "Quản trị" };
let state = loadState();
let toastTimer;
let authUser = null;
let authMode = "signin";

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
  const authButton = document.querySelector("#auth-button");
  authButton.textContent = authUser ? "Đăng xuất" : "Đăng nhập";
  document.querySelector(".demo-indicator").innerHTML = authUser ? "<i></i> SUPABASE · ONLINE" : "<i></i> BẢN DEMO";
  document.querySelector(".demo-indicator").classList.toggle("connected", Boolean(authUser));
  document.querySelectorAll("[data-route]").forEach((el) => el.classList.toggle("active", el.dataset.route === route));
  document.querySelector("#current-section").textContent = ROUTES[route];
  document.querySelector(".user-mini-copy span").textContent = `Thành viên · Lv.${state.profile.level}`;
  const view = document.querySelector("#view");
  view.innerHTML = ({ home: renderHome, training: renderTraining, tournaments: renderTournaments, shop: renderShop, admin: renderAdmin }[route])();
  if (route === "training") {
    const rewardNote = view.querySelector(".content-grid > .stack:last-child .panel:last-child p:last-child");
    rewardNote.textContent = `Mỗi cấp nhận ${state.config.skillPointsPerLevel} điểm kỹ năng và ${state.config.bodyPointsPerLevel} điểm cơ thể.`;
  }
  if (authUser) {
    view.insertAdjacentHTML("afterbegin", '<div class="admin-warning online-notice">Đang xem hồ sơ Supabase thật. Tập luyện, cửa hàng và đăng ký giải vẫn là demo; thao tác thay đổi dữ liệu đã khóa cho đến khi có API server.</div>');
    view.querySelectorAll('[data-action="train"], [data-action="body"], [data-action="skill"], [data-action="buy"], [data-action="register"], [data-action="save-config"]').forEach((button) => {
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
  if (!supabaseClient) return;
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
    <section class="panel tournament-card"><div><div class="tourney-kicker">CÁ NHÂN · LEVEL 10+</div><h2>Rookie Rally</h2><p>Người chơi đăng ký cá nhân, hệ thống ghép đôi ngẫu nhiên khi giải bắt đầu.</p><div class="tourney-data"><span>Ngày thi đấu<strong>12 Tháng 11</strong></span><span>Người chơi<strong>24 / 64</strong></span><span>Thưởng<strong>EXP + điểm thưởng</strong></span></div></div><div class="tournament-status"><span class="status-pill live">ĐANG MỞ ĐĂNG KÝ</span><br/><button class="${state.registered ? "secondary-button" : "dark-button"}" data-action="register" ${state.registered ? "disabled" : ""}>${state.registered ? "✓ Đã đăng ký" : "Đăng ký cá nhân"}</button></div></section>
    <section class="panel tournament-card"><div><div class="tourney-kicker">ĐÔI NGẪU NHIÊN · LEVEL 10+</div><h2>Club Championship</h2><p>32 đôi tranh chức vô địch mùa giải tại Courtside Club.</p><div class="tourney-data"><span>Ngày thi đấu<strong>18 Tháng 11</strong></span><span>Đội<strong>16 / 32</strong></span><span>Phần thưởng<strong>3 điểm kỹ năng + cơ thể</strong></span></div></div><div class="tournament-status"><span class="status-pill">SẮP MỞ</span><br/><button class="secondary-button" disabled>Chưa mở đăng ký</button></div></section>
    <section class="page-section panel panel-pad"><div class="panel-heading"><h2>Lộ trình thi đấu</h2><span class="status-pill">32 ĐÔI · SINGLE ELIMINATION</span></div><div class="bracket"><div class="bracket-round"><strong>VÒNG 1/16</strong><span>32 đội · 16 trận</span></div><div class="bracket-round"><strong>TỨ KẾT</strong><span>8 đội · 4 trận</span></div><div class="bracket-round"><strong>BÁN KẾT</strong><span>4 đội · 2 trận</span></div><div class="bracket-round"><strong>CHUNG KẾT</strong><span>2 đội · 1 trận</span></div></div></section>`;
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
    if (!supabaseClient) return notify("Không tải được Supabase SDK. Hãy tải lại trang.");
    if (authUser) {
      supabaseClient.auth.signOut().then(({ error }) => {
        if (error) notify("Không thể đăng xuất. Hãy thử lại.");
      });
    } else renderAuthModal("signin");
  } else if (action === "auth-toggle") {
    renderAuthModal(authMode === "signin" ? "signup" : "signin");
  } else if (action === "train") {
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