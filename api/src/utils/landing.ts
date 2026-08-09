export function landingPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WeaveLedger — Receipt Tracking</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='20' y='10' width='60' height='80' rx='6' fill='%23BF9B30'/><rect x='32' y='28' width='36' height='4' rx='2' fill='%23fff'/><rect x='32' y='40' width='28' height='4' rx='2' fill='%23fff' opacity='.8'/><rect x='32' y='52' width='32' height='4' rx='2' fill='%23fff' opacity='.6'/><rect x='32' y='64' width='24' height='4' rx='2' fill='%23fff' opacity='.4'/></svg>">
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300;1,9..40,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#0a1628;--navy-mid:#132240;--navy-light:#1a3058;--slate:#364764;
  --gold:#c9a84c;--gold-light:#e4cc7a;--gold-dim:#8a7234;
  --cream:#f5f0e8;--cream-dark:#e8e0d0;--white:#fefcf9;
  --text:#1a1a1a;--text-light:#6b7280;--red:#c44;--green:#2a7a4b;
  --radius:6px;
  --font-display:'DM Serif Display',Georgia,serif;
  --font-body:'DM Sans',-apple-system,sans-serif;
}
html{scroll-behavior:smooth}
body{font-family:var(--font-body);color:var(--text);background:var(--cream);line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}

/* SCROLLBAR */
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--cream-dark);border-radius:3px}

.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:var(--radius);font-family:var(--font-body);font-size:.9rem;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .2s}
.btn-gold{background:var(--gold);color:var(--navy)}.btn-gold:hover{background:var(--gold-light);transform:translateY(-1px)}
.btn-navy{background:var(--navy);color:var(--cream)}.btn-navy:hover{background:var(--navy-mid)}
.btn-outline{background:transparent;color:var(--cream);border:1px solid rgba(245,240,232,.2)}.btn-outline:hover{border-color:var(--gold);color:var(--gold)}
.btn-sm{padding:8px 16px;font-size:.82rem}
.btn-refresh{background:none;border:1px solid var(--cream-dark,#e0d9cf);border-radius:8px;width:34px;height:34px;font-size:1.1rem;cursor:pointer;color:var(--text-light);display:flex;align-items:center;justify-content:center;transition:all .2s}.btn-refresh:hover{border-color:var(--gold);color:var(--gold);background:rgba(191,155,48,.06)}.btn-refresh.spinning{animation:spin .6s linear}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.btn-danger{background:#fef2f2;color:var(--red);border:1px solid rgba(204,68,68,.15)}.btn-danger:hover{background:#fee2e2}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
/* AUTH SCREEN (login-only landing) */
#landing{min-height:100vh;background:var(--navy);display:flex;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden}
#landing::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 31px,rgba(245,240,232,.025) 31px 32px);pointer-events:none}
#landing::after{content:'';position:absolute;top:-30%;left:50%;transform:translateX(-50%);width:720px;height:720px;border-radius:50%;background:radial-gradient(circle,rgba(201,168,76,.10),transparent 62%);pointer-events:none}
.auth-wrap{position:relative;z-index:1;width:100%;max-width:400px;text-align:center;animation:fadeUp .5s ease both}
.auth-logo{width:52px;height:52px;margin:0 auto 16px;display:block}
.auth-brand{font-family:var(--font-display);font-size:2.3rem;letter-spacing:-.02em;line-height:1;margin-bottom:9px}
.auth-brand .b-w{color:#fff}.auth-brand .b-l{color:var(--gold-light)}
.auth-tag{font-size:.82rem;color:rgba(245,240,232,.5);letter-spacing:.14em;text-transform:uppercase;margin-bottom:34px}
.auth-card{background:#132240;border:1px solid rgba(245,240,232,.08);border-radius:16px;padding:34px 30px;text-align:left;box-shadow:0 24px 64px rgba(0,0,0,.45)}
.auth-rule{height:2px;width:44px;background:var(--gold);border-radius:1px;margin-bottom:20px}
.auth-card h3{font-size:1.12rem;font-weight:600;color:var(--cream);margin-bottom:4px}
.auth-card .auth-sub{font-size:.85rem;color:rgba(245,240,232,.5);margin-bottom:24px}
#landing .form-group label{color:rgba(245,240,232,.55)}
#landing .form-input{background:#1A3058;border:1px solid rgba(245,240,232,.12);color:var(--cream)}
#landing .form-input::placeholder{color:rgba(245,240,232,.3)}
#landing .form-input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.15)}
#landing .form-error{background:rgba(204,68,68,.12);border:1px solid rgba(204,68,68,.3);color:#f0a0a0}
.btn-auth{width:100%;justify-content:center;background:var(--gold-light);color:var(--navy);border-radius:12px;padding:14px;font-size:1rem;font-weight:600}
.btn-auth:hover{filter:brightness(1.05)}
.auth-aux{text-align:center;margin-top:16px}
.auth-aux a{font-size:.85rem;color:var(--gold-light);text-decoration:none}
.auth-aux a:hover{text-decoration:underline}
.auth-foot{margin-top:28px;font-size:.76rem;color:rgba(245,240,232,.35)}
.auth-foot a{color:rgba(245,240,232,.45);text-decoration:none;margin:0 7px}
.auth-foot a:hover{color:var(--gold-light)}
.auth-h3{font-family:var(--font-display);font-size:1.25rem;color:var(--cream);margin-bottom:6px}
.auth-p{color:rgba(245,240,232,.5);font-size:.85rem;margin-bottom:20px}
#landing .form-success{color:#7fd7a8;background:rgba(56,161,105,.12);border:1px solid rgba(56,161,105,.3)}

/* FORM ELEMENTS */
.form-group{margin-bottom:18px}
.form-group label{display:block;font-size:.78rem;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.form-input,.form-select,.form-textarea{width:100%;padding:10px 14px;border-radius:var(--radius);border:1.5px solid var(--cream-dark);background:var(--white);font-family:var(--font-body);font-size:.9rem;color:var(--text);transition:border-color .2s;outline:none}
.form-input:focus,.form-select:focus,.form-textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.12)}
.form-textarea{resize:vertical;min-height:80px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.form-error{background:#fef2f2;color:var(--red);padding:10px 14px;border-radius:var(--radius);font-size:.85rem;margin-bottom:16px;display:none;border:1px solid rgba(204,68,68,.15)}

/* APP LAYOUT */
.app{display:none;min-height:100vh;background:var(--cream)}
.app-nav{background:var(--navy);border-bottom:1px solid rgba(201,168,76,.15);padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.logo{font-family:var(--font-display);font-size:1.35rem;color:var(--cream);letter-spacing:-.02em;text-decoration:none}
.logo span{color:var(--gold)}
.app-nav-left{display:flex;align-items:center;gap:32px}
.app-nav-links{display:flex;gap:4px}
.app-nav-links a{color:rgba(245,240,232,.5);text-decoration:none;font-size:.82rem;font-weight:500;padding:6px 14px;border-radius:var(--radius);transition:all .2s}
.app-nav-links a:hover{color:var(--cream);background:rgba(245,240,232,.08)}
.app-nav-links a.active{color:var(--gold);background:rgba(201,168,76,.1)}
.app-nav-right{display:flex;align-items:center;gap:12px}
.app-user{color:rgba(245,240,232,.6);font-size:.82rem}
.app-user strong{color:var(--cream)}
.app-logout{background:none;border:1px solid rgba(245,240,232,.15);color:var(--cream);padding:5px 14px;border-radius:var(--radius);font-family:var(--font-body);font-size:.8rem;cursor:pointer;transition:all .2s}
.app-logout:hover{border-color:var(--gold);color:var(--gold)}

/* PAGE CONTENT */
.page{max-width:1200px;margin:0 auto;padding:32px 24px;display:none}
.page.active{display:block}
.page-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;flex-wrap:wrap;gap:16px}
.page-title{font-family:var(--font-display);font-size:1.8rem;color:var(--navy)}
.page-subtitle{color:var(--text-light);font-size:.9rem;margin-top:2px}

/* CARDS */
.card{background:var(--white);border-radius:10px;border:1px solid rgba(10,22,40,.06);padding:24px;margin-bottom:16px;transition:all .2s}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-family:var(--font-display);font-size:1.1rem;color:var(--navy)}

/* STAT CARDS */
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:var(--white);border-radius:10px;border:1px solid rgba(10,22,40,.06);padding:20px 24px}
.stat-label{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-light);margin-bottom:4px}
.stat-value{font-family:var(--font-display);font-size:1.5rem;color:var(--navy)}
.stat-sub{font-size:.8rem;color:var(--text-light);margin-top:2px}

/* CHARTS */
.chart-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px}
.bar-chart{display:flex;align-items:flex-end;gap:6px;height:240px;padding:0 0 16px;overflow:visible;justify-content:center}
.bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px}
.bar{background:var(--gold);border-radius:3px 3px 0 0;width:100%;min-height:2px;transition:height .5s ease}
.bar:hover{background:var(--gold-light)}
.bar-label{font-size:.65rem;color:var(--text-light);white-space:nowrap;height:20px;line-height:20px;flex-shrink:0}
.bar-value{font-size:.65rem;font-weight:600;color:var(--navy);height:16px;line-height:16px;flex-shrink:0}
.cat-list{list-style:none}
.cat-item{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(10,22,40,.04)}
.cat-item:last-child{border:none}
.cat-dot{width:8px;height:8px;border-radius:50%;margin-right:10px;flex-shrink:0}
.cat-name{font-size:.85rem;color:var(--text);flex:1}
.cat-amount{font-size:.85rem;font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums}
.cat-count{font-size:.75rem;color:var(--text-light);margin-left:8px}

/* TABLE */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-light);padding:10px 12px;border-bottom:2px solid var(--cream-dark)}
td{padding:12px;border-bottom:1px solid rgba(10,22,40,.04);font-size:.88rem;vertical-align:middle}
tr:hover td{background:rgba(201,168,76,.03)}
tr{cursor:pointer}
.status-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.72rem;font-weight:600}
.status-completed{background:#e8f5ee;color:var(--green)}
.status-pending,.status-processing{background:#fef3cd;color:#856404}
.status-failed{background:#fef2f2;color:var(--red)}
.source-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:500;background:rgba(201,168,76,.1);color:var(--gold-dim)}

/* FILTERS BAR */
.filters-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center}
.filter-input{padding:7px 12px;border:1.5px solid var(--cream-dark);border-radius:var(--radius);font-family:var(--font-body);font-size:.82rem;background:var(--white);outline:none;transition:border-color .2s}
.filter-input:focus{border-color:var(--gold)}
.filter-select{padding:7px 12px;border:1.5px solid var(--cream-dark);border-radius:var(--radius);font-family:var(--font-body);font-size:.82rem;background:var(--white);outline:none}

/* PAGINATION */
.pagination{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:12px 16px}
.pagination-info{font-size:.82rem;color:var(--text-light)}
.pagination-btns{display:flex;gap:8px}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(10,22,40,.6);backdrop-filter:blur(4px);z-index:200;display:none;align-items:center;justify-content:center;padding:24px}
.modal-overlay.show{display:flex}
.modal{background:var(--white);border-radius:12px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 32px 64px rgba(0,0,0,.25)}
.modal-header{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--cream-dark)}
.modal-header h2{font-family:var(--font-display);font-size:1.2rem;color:var(--navy)}
.modal-close{background:none;border:none;font-size:1.4rem;color:var(--text-light);cursor:pointer;padding:4px;line-height:1}
.modal-close:hover{color:var(--text)}
.modal-body{padding:24px}
.modal-footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--cream-dark)}

/* ONBOARDING WIZARD */
.onb-card{position:relative;background:var(--navy-mid,#132240);color:var(--cream,#F5F0E8);border:1px solid rgba(245,240,232,.1);border-radius:16px;max-width:440px;width:100%;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.45)}
.onb-x{position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(245,240,232,.5);font-size:1.4rem;line-height:1;cursor:pointer;font-family:inherit}
.onb-x:hover{color:var(--gold-light,#E4CC7A)}
.onb-dots{display:flex;gap:6px;justify-content:center;margin-bottom:18px}
.onb-dot{width:7px;height:7px;border-radius:50%;background:rgba(245,240,232,.25)}
.onb-dot.on{background:var(--gold,#C9A84C)}
.onb-card h2{font-size:1.25rem;margin-bottom:8px;color:var(--cream,#F5F0E8)}
.onb-card p{color:rgba(245,240,232,.7);font-size:.92rem;line-height:1.6;margin-bottom:20px}
.onb-actions{display:flex;gap:10px;align-items:center}
.onb-actions .spacer{flex:1}
.onb-skip{background:none;border:none;color:rgba(245,240,232,.5);font-size:.85rem;cursor:pointer;font-family:inherit}
.onb-skip:hover{color:var(--gold-light,#E4CC7A)}
#replayOnb{color:var(--gold-dim);text-decoration:underline}
#replayOnb:hover{color:var(--gold-light,#E4CC7A)}
.onb-btn{background:var(--gold-light,#E4CC7A);color:var(--navy,#0A1628);border:none;border-radius:10px;padding:10px 18px;font-weight:600;font-size:.92rem;cursor:pointer;font-family:inherit}
.onb-btn.ghost{background:transparent;color:var(--cream,#F5F0E8);border:1px solid rgba(245,240,232,.25)}

/* RECEIPT DETAIL PANEL */
.detail-panel{display:none;position:fixed;top:56px;right:0;bottom:0;width:480px;background:var(--white);box-shadow:-8px 0 32px rgba(0,0,0,.1);z-index:40;overflow-y:auto;border-left:1px solid var(--cream-dark)}
.detail-panel.open{display:block}
.detail-header{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--cream-dark);position:sticky;top:0;background:var(--white);z-index:1}
.detail-content{padding:24px}
.detail-section{margin-bottom:24px}
.detail-section h4{font-family:var(--font-display);font-size:.95rem;color:var(--navy);margin-bottom:12px}
.detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(10,22,40,.03)}
.detail-row .dl{font-size:.82rem;color:var(--text-light)}
.detail-row .dv{font-size:.88rem;color:var(--text);font-weight:500;text-align:right}
.line-item-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(10,22,40,.03);font-size:.85rem}
.line-item-desc{flex:1;color:var(--text)}
.line-item-qty{color:var(--text-light);margin:0 12px;font-size:.8rem}
.line-item-total{font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums}

/* IMAGE VIEWER */
.img-viewer{text-align:center;margin:16px 0}
.img-viewer img{max-width:100%;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1)}

/* EXPORT PANEL */
.export-formats{display:grid;gap:10px}
.settings-tabs{display:flex;gap:0;border-bottom:2px solid var(--cream-dark);margin-bottom:24px}
.settings-tab{padding:10px 20px;font-size:.85rem;font-weight:600;color:var(--text-light);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s}
.settings-tab:hover{color:var(--navy)}
.settings-tab.active{color:var(--navy);border-bottom-color:var(--gold)}
.settings-panel{display:none}
.settings-panel.active{display:block}
.export-option{display:flex;align-items:center;gap:14px;padding:14px 18px;border:1.5px solid var(--cream-dark);border-radius:var(--radius);cursor:pointer;transition:all .2s}
.export-option:hover{border-color:var(--gold);background:rgba(201,168,76,.03)}
.export-option.selected{border-color:var(--gold);background:rgba(201,168,76,.06)}
.export-option h4{font-size:.92rem;color:var(--navy);margin-bottom:2px}
.export-option p{font-size:.78rem;color:var(--text-light)}

/* SHARE */
.share-item{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(10,22,40,.04)}
.share-info{display:flex;flex-direction:column}
.share-name{font-size:.9rem;font-weight:500;color:var(--navy)}
.share-email{font-size:.78rem;color:var(--text-light)}
.share-perm{font-size:.72rem;padding:3px 10px;border-radius:12px;background:var(--cream);color:var(--gold-dim);font-weight:600}

/* EMPTY STATE */
.empty{text-align:center;padding:60px 20px;color:var(--text-light)}
.empty-icon{font-size:3rem;margin-bottom:12px;opacity:.3}
.loading{text-align:center;padding:40px;color:var(--text-light);font-size:.9rem}

/* TOAST */
.toast{position:fixed;bottom:24px;right:24px;padding:14px 20px;border-radius:var(--radius);color:#fff;font-size:.88rem;font-weight:500;z-index:300;transform:translateY(100px);opacity:0;transition:all .3s ease;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.toast.show{transform:translateY(0);opacity:1}
.toast-success{background:var(--green)}
.toast-error{background:var(--red)}

/* ANIMATIONS */
@keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}

/* RESPONSIVE */
@media(max-width:860px){
  .chart-grid{grid-template-columns:1fr}
  .detail-panel{width:100%}
  .form-row{grid-template-columns:1fr}
  .app-nav-links{display:none}
  .stats-row{grid-template-columns:1fr 1fr}
}
</style>
</head>
<body>

<!-- LANDING -->
<div id="landing">
<main class="auth-wrap">
  <svg class="auth-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 3.5h11.5A2.5 2.5 0 0 1 19 6v12.5a2 2 0 0 1-2 2H7a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5Z" stroke="#C9A84C" stroke-width="1.6"/>
    <path d="M8.5 3.5v17" stroke="#C9A84C" stroke-width="1.6"/>
    <path d="M12 8.5h4M12 12h4" stroke="#C9A84C" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <div class="auth-brand" role="img" aria-label="WeaveLedger"><span class="b-w">Weave</span><span class="b-l">Ledger</span></div>
  <div class="auth-tag">Smart expense tracking</div>
  <section class="auth-card" id="login" aria-labelledby="authTitle">
    <div class="auth-rule"></div>
    <h3 id="authTitle">Welcome back</h3>
    <p class="auth-sub" id="authDesc">Sign in to your ledger.</p>
    <div id="loginError" class="form-error"></div>
    <form id="loginForm">
      <div id="nameGroup" class="form-group" style="display:none">
        <label for="regName">Name</label>
        <input class="form-input" type="text" id="regName" autocomplete="name" placeholder="Your Name">
      </div>
      <div class="form-group">
        <label for="loginEmail">Email Address</label>
        <input class="form-input" type="email" id="loginEmail" required autocomplete="email webauthn" placeholder="you@company.com">
      </div>
      <div class="form-group">
        <label for="loginPass">Password</label>
        <input class="form-input" type="password" id="loginPass" required autocomplete="current-password" placeholder="Enter your password">
      </div>
      <button type="submit" class="btn btn-auth" id="loginBtn">Sign In</button>
    </form>
    <div id="passkeyRow" style="display:none">
      <div style="display:flex;align-items:center;gap:12px;margin:16px 0 12px"><div style="flex:1;height:1px;background:rgba(245,240,232,.12)"></div><span style="font-size:.72rem;color:rgba(245,240,232,.45);text-transform:uppercase;letter-spacing:.08em">or</span><div style="flex:1;height:1px;background:rgba(245,240,232,.12)"></div></div>
      <button type="button" class="btn" id="passkeyLoginBtn" style="width:100%;justify-content:center;background:rgba(245,240,232,.06);color:var(--cream,#F5F0E8);border:1px solid rgba(245,240,232,.25);border-radius:12px;padding:13px;font-size:.95rem;font-weight:600">&#x1F511; Sign in with a passkey</button>
    </div>
    <div class="auth-aux" style="display:flex;justify-content:space-between;gap:12px">
      <a href="#" id="registerToggle" style="display:none">Create an account</a>
      <a href="#" id="forgotPassLink">Forgot password?</a>
    </div>
    <div id="forgotPassForm" style="display:none">
      <h3 class="auth-h3">Reset Password</h3>
      <p class="auth-p">Enter your email to receive a reset link.</p>
      <div id="forgotError" class="form-error"></div>
      <div id="forgotSuccess" class="form-error form-success"></div>
      <div class="form-group"><label for="forgotEmail">Email Address</label><input class="form-input" type="email" id="forgotEmail" required placeholder="you@company.com"></div>
      <button type="button" class="btn btn-auth" id="forgotBtn">Send Reset Link</button>
      <div class="auth-aux"><a href="#" id="backToLogin">Back to Sign In</a></div>
    </div>
    <div id="resetPassForm" style="display:none">
      <h3 class="auth-h3">Set New Password</h3>
      <p class="auth-p">Enter your new password below.</p>
      <div id="resetError" class="form-error"></div>
      <div id="resetSuccess" class="form-error form-success"></div>
      <div class="form-group"><label for="resetNewPass">New Password</label><input class="form-input" type="password" id="resetNewPass" required autocomplete="new-password" placeholder="Min. 8 characters" minlength="8"></div>
      <div class="form-group"><label for="resetConfirmPass">Confirm Password</label><input class="form-input" type="password" id="resetConfirmPass" required autocomplete="new-password" placeholder="Confirm new password"></div>
      <button type="button" class="btn btn-auth" id="resetBtn">Reset Password</button>
    </div>
  </section>
  <div class="auth-foot"><a href="/terms">Terms</a>&middot;<a href="/privacy">Privacy</a></div>
</main>
</div>

<!-- APP -->
<div id="app" class="app">
<div class="app-nav">
  <div class="app-nav-left">
    <a class="logo" href="#">Weave<span>Ledger</span></a>
    <div class="app-nav-links" id="navLinks">
      <a href="#" data-page="dashboard" class="active">Overview</a>
      <a href="#" data-page="expenses">Expenses</a>
      <a href="#" data-page="reports">Reports</a>
      <a href="#" data-page="income">Revenue</a>
      <a href="#" data-page="subscriptions">Subscriptions</a>
      <a href="#" data-page="budgets">Budgets</a>
      <a href="#" data-page="recurring">Recurring</a>
      <a href="#" data-page="tax">Tax</a>
      <a href="#" data-page="settings">Settings</a>
    </div>
  </div>
  <div class="app-nav-right">
    <span class="app-user">Signed in as <strong id="appEmail"></strong></span>
    <button class="app-logout" id="logoutBtn">Sign Out</button>
  </div>
</div>

<!-- DASHBOARD / FINANCIAL OVERVIEW PAGE -->
<div class="page active" id="pg-dashboard">
  <div class="page-header"><div><h1 class="page-title">Financial Overview</h1><p class="page-subtitle" id="dashSubtitle">Your business at a glance</p></div>
    <div style="display:flex;gap:8px;align-items:center"><select class="filter-select" id="dashBookSelect" style="min-width:180px"></select><button class="btn-refresh" id="refreshDash" title="Refresh">&#x21bb;</button></div>
  </div>
  <div class="stats-row" id="dashStats"></div>
  <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">Revenue vs Expenses</span><span id="dashPeriodLabel" style="font-size:.78rem;color:var(--text-light)">Last 12 months</span></div><div class="bar-chart" id="monthlyChart"></div>
    <div style="display:flex;gap:16px;padding:4px 0 0;font-size:.75rem;color:var(--text-light)"><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--green)"></span> Revenue</span><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--gold)"></span> Expenses</span></div>
  </div>
  <div class="chart-grid">
    <div class="card"><div class="card-header"><span class="card-title">Top Expense Categories</span></div><ul class="cat-list" id="catList"></ul></div>
    <div class="card"><div class="card-header"><span class="card-title">Revenue by Source</span></div><ul class="cat-list" id="dashSourceList"></ul></div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><span class="card-title">Profit &amp; Loss</span>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="filter-select" id="pnlPeriod" style="font-size:.8rem;padding:4px 8px"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
        <select class="filter-select" id="pnlYear" style="font-size:.8rem;padding:4px 8px"></select>
      </div>
    </div>
    <div class="stats-row" id="pnlStats" style="margin-bottom:12px"></div>
    <div class="table-wrap"><table><thead><tr><th>Period</th><th style="text-align:right">Revenue</th><th style="text-align:right">Expenses</th><th style="text-align:right">Net Profit</th><th style="text-align:right">Margin</th></tr></thead><tbody id="pnlTable"></tbody></table></div>
  </div>
  <div class="card"><div class="card-header"><span class="card-title">Recent Activity</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead><tbody id="recentActivity"></tbody></table></div></div>
</div>

<!-- BOOKS PAGE -->
<!-- EXPENSES PAGE -->
<div class="page" id="pg-expenses">
  <div class="page-header"><div><h1 class="page-title">Expenses</h1><p class="page-subtitle" id="receiptsSubtitle">All expenses</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-gold btn-sm" id="addReceiptBtn">+ Add Receipt</button>
      <button class="btn btn-outline btn-sm" id="uploadReceiptBtn" style="color:var(--navy);border-color:var(--cream-dark)">Upload Image</button>
      <button class="btn-refresh" id="refreshExpenses" title="Refresh">&#x21bb;</button>
    </div>
  </div>
  <div class="filters-bar" id="filtersBar">
    <select class="filter-select" id="receiptBookFilter" style="min-width:160px"></select>
    <input class="filter-input" type="text" id="searchFilter" placeholder="Search merchant...">
    <select class="filter-select" id="categoryFilter"><option value="">All Categories</option></select>
    <select class="filter-select" id="statusFilter"><option value="">All Statuses</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="failed">Failed</option></select>
    <input class="filter-input" type="date" id="dateFromFilter" title="From date">
    <input class="filter-input" type="date" id="dateToFilter" title="To date">
  </div>
  <div id="selectionBar" style="display:none;align-items:center;gap:12px;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.4);border-radius:10px;padding:10px 14px;margin-bottom:12px">
    <span id="selCount" style="font-weight:600;font-size:.85rem"></span>
    <button class="btn btn-gold btn-sm" id="addSelToReportBtn">Add to Report</button>
    <button class="btn btn-outline btn-sm" id="clearSelBtn" style="color:var(--navy);border-color:var(--cream-dark)">Clear</button>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrap"><table><thead><tr><th style="width:34px"></th><th class="bookcol" style="display:none">Book</th><th>Date</th><th>Merchant</th><th>Category</th><th>Amount</th><th>Source</th><th>Status</th></tr></thead><tbody id="receiptsTable"></tbody></table></div>
    <div class="pagination" id="receiptsPagination"></div>
  </div>
</div>

<!-- REVENUE PAGE -->
<!-- REPORTS PAGE -->
<div class="page" id="pg-reports">
  <div class="page-header"><div><h1 class="page-title">Expense Reports</h1><p class="page-subtitle">Bundle receipts to hand to a client or employer</p></div>
    <div style="display:flex;gap:8px"><button class="btn btn-gold btn-sm" id="addReportBtn">+ New Report</button><button class="btn-refresh" id="refreshReports" title="Refresh">&#x21bb;</button></div></div>
  <div class="card"><div class="card-header"><span class="card-title">Reports</span></div><div id="reportList"><div class="loading">Loading...</div></div></div>
  <div class="card" id="reportDetailCard" style="display:none"><div class="card-header"><span class="card-title" id="reportDetailTitle"></span><div style="display:flex;gap:8px;flex-wrap:wrap" id="reportDetailActions"></div></div><div id="reportDetail"></div></div>
</div>

<div class="page" id="pg-income">
  <div class="page-header"><div><h1 class="page-title">Revenue</h1><p class="page-subtitle">Income from connected platforms</p></div><button class="btn-refresh" id="refreshIncome" title="Refresh">&#x21bb;</button></div>
  <div class="stats-row" id="incomeStats"></div>
  <div class="chart-grid">
    <div class="card"><div class="card-header"><span class="card-title">Monthly Revenue</span></div><div class="bar-chart" id="incomeMonthlyChart"></div></div>
    <div class="card"><div class="card-header"><span class="card-title">By Source</span></div><ul class="cat-list" id="incomeSourceList"></ul></div>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Source</th><th>Description</th><th style="text-align:right">Customer Paid</th><th style="text-align:right">Platform Fee</th><th style="text-align:right">You Earned</th></tr></thead><tbody id="incomeTable"></tbody></table></div>
    <div class="pagination" id="incomePagination"></div>
  </div>
</div>

<!-- SUBSCRIPTIONS PAGE -->
<div class="page" id="pg-subscriptions">
  <div class="page-header"><div><h1 class="page-title">Subscriptions</h1><p class="page-subtitle">Recurring revenue and forecasting</p></div><button class="btn-refresh" id="refreshSubs" title="Refresh">&#x21bb;</button></div>
  <div class="stats-row" id="subStats"></div>
  <div class="chart-grid">
    <div class="card"><div class="card-header"><span class="card-title">Revenue Forecast</span></div><div class="bar-chart" id="subForecastChart"></div></div>
    <div class="card"><div class="card-header"><span class="card-title">By Source</span></div><ul class="cat-list" id="subSourceList"></ul></div>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="card-header" style="padding:16px 20px"><span class="card-title">Active Subscriptions</span></div>
    <div class="table-wrap"><table><thead><tr><th>Product</th><th>Source</th><th>Plan</th><th>Amount</th><th>Status</th><th>Next Renewal</th></tr></thead><tbody id="subTable"></tbody></table></div>
    <div class="pagination" id="subPagination"></div>
  </div>
</div>

<!-- SETTINGS PAGE -->
<div class="page" id="pg-settings">
  <div class="page-header"><div><h1 class="page-title">Settings</h1><p class="page-subtitle">Account, books, and preferences</p></div></div>
  <div class="settings-tabs" id="settingsTabs">
    <a href="#" class="settings-tab active" data-stab="account">Account</a>
    <a href="#" class="settings-tab" data-stab="books">Books</a>
    <a href="#" class="settings-tab" data-stab="export">Export</a>
    <a href="#" class="settings-tab" data-stab="integrations">Integrations</a>
    <a href="#" class="settings-tab" data-stab="ai">AI Provider</a>
  </div>
  <!-- ACCOUNT TAB -->
  <div class="settings-panel active" id="stab-account">
    <div class="card">
      <div class="card-header"><span class="card-title">Profile</span></div>
      <div class="detail-row"><span class="dl">Email</span><span class="dv" id="settEmail"></span></div>
      <div class="detail-row"><span class="dl">Name</span><span class="dv" id="settName"></span></div>
      <div class="detail-row"><span class="dl">Role</span><span class="dv" id="settRole"></span></div>
      <div class="detail-row"><span class="dl">Member Since</span><span class="dv" id="settSince"></span></div>
      <div class="detail-row"><span class="dl">Two-Factor Auth</span><span class="dv" id="settMfa"></span></div>
      <div class="detail-row"><span class="dl">Getting started</span><span class="dv"><button class="onb-skip" id="replayOnb" type="button">Replay walkthrough</button></span></div>
    </div>
    <div class="card" id="mfaCard">
      <div class="card-header"><span class="card-title">Two-Factor Authentication</span></div>
      <div id="mfaContent"></div>
    </div>
    <div class="card" id="passkeysCard">
      <div class="card-header"><span class="card-title">Passkeys</span></div>
      <p style="font-size:.85rem;color:var(--text-light);padding:0 0 12px">Sign in with Face ID, Touch ID, or your device PIN — no password or authenticator code needed. Passkeys are phishing-resistant and count as two-factor on their own.</p>
      <div id="passkeysList"></div>
      <button class="btn btn-gold" id="addPasskeyBtn" style="margin-top:12px">+ Add a Passkey</button>
    </div>
    <div class="card" id="linkedEmailsCard">
      <div class="card-header"><span class="card-title">Linked Email Addresses</span></div>
      <p style="font-size:.85rem;color:var(--text-light);padding:0 0 12px">Add email addresses you send receipts from. Receipts emailed from any linked address will be attributed to your account.</p>
      <div id="linkedEmailsList"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input class="form-input" type="email" id="newLinkedEmail" placeholder="another@email.com" style="flex:1">
        <button class="btn btn-sm btn-gold" id="addLinkedEmailBtn">Add</button>
      </div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark)">
        <label style="display:block;font-size:.85rem;font-weight:600;color:var(--navy);margin-bottom:4px">Default book for emailed receipts</label>
        <p style="font-size:.8rem;color:var(--text-light);margin:0 0 8px">New email receipts land here. Only open books can be chosen; if none is set, receipts go to your oldest open book.</p>
        <select class="form-input" id="defaultEmailBook"></select>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Change Password</span></div>
      <div class="form-error" id="pwdError"></div>
      <div class="form-group"><label>Current Password</label><input class="form-input" type="password" id="curPwd"></div>
      <div class="form-group"><label>New Password</label><input class="form-input" type="password" id="newPwd"></div>
      <div class="form-group"><label>Confirm New Password</label><input class="form-input" type="password" id="conPwd"></div>
      <button class="btn btn-navy" id="changePwdBtn">Update Password</button>
    </div>
  </div>
  <!-- BOOKS TAB -->
  <div class="settings-panel" id="stab-books">
    <div class="page-header" style="padding:0 0 20px"><div><p class="page-subtitle">Manage your expense books</p></div>
      <button class="btn btn-gold" id="newBookBtn">+ New Book</button>
    </div>
    <div id="booksGrid" class="stats-row"></div>
  </div>
  <!-- EXPORT TAB -->
  <div class="settings-panel" id="stab-export">
    <div class="card">
      <div class="card-header"><span class="card-title">Export Data</span></div>
      <p style="font-size:.85rem;color:var(--text-light);padding:0 0 16px">Download your data in any format</p>
      <div class="form-row" style="margin-bottom:20px">
        <div class="form-group"><label>Book</label><select class="form-select" id="exportBookSelect"></select></div>
        <div class="form-group"><label>Category (optional)</label><select class="form-select" id="exportCategory"><option value="">All Categories</option></select></div>
      </div>
      <div class="form-row" style="margin-bottom:24px">
        <div class="form-group"><label>Date From</label><input class="form-input" type="date" id="exportDateFrom"></div>
        <div class="form-group"><label>Date To</label><input class="form-input" type="date" id="exportDateTo"></div>
      </div>
      <div class="export-formats" id="exportFormats">
        <div class="export-option selected" data-fmt="csv"><div><h4>CSV</h4><p>Comma-separated values for Excel, Google Sheets</p></div></div>
        <div class="export-option" data-fmt="json"><div><h4>JSON</h4><p>Structured data for developers and integrations</p></div></div>
        <div class="export-option" data-fmt="qbo"><div><h4>QuickBooks (IIF)</h4><p>Import directly into QuickBooks Desktop</p></div></div>
        <div class="export-option" data-fmt="ofx"><div><h4>OFX</h4><p>Open Financial Exchange for most accounting software</p></div></div>
        <div class="export-option" data-fmt="pdf"><div><h4>PDF Data</h4><p>Structured receipt summary data</p></div></div>
      </div>
      <div style="margin-top:20px;text-align:right"><button class="btn btn-gold" id="exportBtn">Download Export</button></div>
    </div>
  </div>
  <!-- INTEGRATIONS TAB -->
  <div class="settings-panel" id="stab-integrations">
    <div class="card" id="integrationsCard">
      <div class="card-header"><span class="card-title">Revenue Integrations</span></div>
      <p style="font-size:.85rem;color:var(--text-light);padding:0 0 16px">Connect your revenue platforms to track income alongside expenses. Credentials are encrypted at rest.</p>
      <div id="integrationsList"></div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" onclick="showIntegrationModal('stripe')">+ Stripe</button>
        <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" onclick="showIntegrationModal('google_play')">+ Google Play</button>
        <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" onclick="showIntegrationModal('apple_app_store')">+ Apple App Store</button>
      </div>
    </div>
  </div>
  <!-- AI PROVIDER TAB -->
  <div class="settings-panel" id="stab-ai">
    <div class="card" id="aiProviderCard">
      <div class="card-header"><span class="card-title">AI Provider</span></div>
      <p style="font-size:.85rem;color:var(--text-light);padding:0 0 12px">Choose which AI provider to use for receipt analysis. Both support image and PDF scanning.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px" id="aiProviderOptions">
        <label style="flex:1;min-width:200px;padding:16px;border:2px solid var(--cream-dark);border-radius:var(--radius);cursor:pointer;transition:all .2s" id="providerAnthropic">
          <input type="radio" name="aiProvider" value="anthropic" style="margin-right:8px">
          <strong style="font-size:.92rem;color:var(--navy)">Anthropic Claude</strong>
          <p style="font-size:.78rem;color:var(--text-light);margin:4px 0 0 22px">Claude Sonnet 4 — excellent at structured extraction</p>
        </label>
        <label style="flex:1;min-width:200px;padding:16px;border:2px solid var(--cream-dark);border-radius:var(--radius);cursor:pointer;transition:all .2s" id="providerOpenai">
          <input type="radio" name="aiProvider" value="openai" style="margin-right:8px">
          <strong style="font-size:.92rem;color:var(--navy)">OpenAI GPT-4o</strong>
          <p style="font-size:.78rem;color:var(--text-light);margin:4px 0 0 22px">GPT-4o — strong vision and PDF analysis</p>
        </label>
        <label style="flex:1;min-width:200px;padding:16px;border:2px solid var(--cream-dark);border-radius:var(--radius);cursor:pointer;transition:all .2s" id="providerWeavehub">
          <input type="radio" name="aiProvider" value="weavehub" style="margin-right:8px">
          <strong style="font-size:.92rem;color:var(--navy)">WeaveHub AI</strong>
          <p style="font-size:.78rem;color:var(--text-light);margin:4px 0 0 22px">Pay as you go — no provider account needed</p>
        </label>
      </div>
      <div id="weavehubAiPanel" style="display:none;border:1px solid var(--gold);border-radius:var(--radius);padding:16px;margin-bottom:20px;background:rgba(201,168,76,.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <p style="font-size:.82rem;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.06em">WeaveHub AI usage</p>
            <p style="font-size:.95rem;margin-top:4px" id="weavehubUsageText">Loading…</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="whBuyRow">
            <button class="btn btn-sm btn-gold" id="whBuyStarter">Buy 500 scans · $9.99</button>
            <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--navy)" id="whBuyGrowth">Buy 2,000 scans · $29.99</button>
          </div>
          <button class="btn btn-sm btn-gold" id="whCreateKey" style="display:none">Create my key — includes 3 trial scans</button>
        </div>
        <p style="font-size:.75rem;color:var(--text-light);margin-top:8px">Credits never expire and are purchased through Stripe. Checkout returns you to this page.</p>
      </div>
      <div style="border-top:1px solid var(--cream-dark);padding-top:16px">
        <p style="font-size:.82rem;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">API Keys</p>
        <p style="font-size:.82rem;color:var(--text-light);margin-bottom:12px">Enter your own API keys or leave blank to use the platform default. Keys are encrypted at rest.</p>
        <div class="form-group" id="anthropicKeyGroup">
          <label>Anthropic API Key</label>
          <div style="display:flex;gap:8px"><input class="form-input" type="password" id="settAnthropicKey" placeholder="sk-ant-..."><button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark);white-space:nowrap" id="saveAnthropicKey">Save</button><button class="btn btn-sm btn-danger" style="white-space:nowrap;display:none" id="clearAnthropicKey">Clear</button></div>
          <span style="font-size:.75rem;color:var(--text-light)" id="anthropicKeyStatus"></span>
        </div>
        <div class="form-group" id="openaiKeyGroup">
          <label>OpenAI API Key</label>
          <div style="display:flex;gap:8px"><input class="form-input" type="password" id="settOpenaiKey" placeholder="sk-..."><button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark);white-space:nowrap" id="saveOpenaiKey">Save</button><button class="btn btn-sm btn-danger" style="white-space:nowrap;display:none" id="clearOpenaiKey">Clear</button></div>
          <span style="font-size:.75rem;color:var(--text-light)" id="openaiKeyStatus"></span>
        </div>
        <div class="form-group" id="weavehubKeyGroup">
          <label>WeaveHub AI Key</label>
          <div style="display:flex;gap:8px"><input class="form-input" type="password" id="settWeavehubKey" placeholder="wh_ai_..."><button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark);white-space:nowrap" id="saveWeavehubKey">Save</button><button class="btn btn-sm btn-danger" style="white-space:nowrap;display:none" id="clearWeavehubKey">Clear</button></div>
          <span style="font-size:.75rem;color:var(--text-light)" id="weavehubKeyStatus"></span>
          <span style="font-size:.75rem;color:var(--text-light)">Moving from another instance? Paste its key here — otherwise use "Create my key" above and it's saved automatically.</span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- BUDGETS PAGE -->
<div class="page" id="pg-budgets">
  <div class="page-header"><div><h1 class="page-title">Budgets</h1><p class="page-subtitle" id="budgetPeriodLabel">Track spending against your limits</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <select class="filter-select" id="budgetMonth" style="font-size:.8rem;padding:4px 8px"></select>
      <select class="filter-select" id="budgetYear" style="font-size:.8rem;padding:4px 8px"></select>
      <button class="btn btn-gold btn-sm" id="addBudgetBtn">+ Add Budget</button><button class="btn-refresh" id="refreshBudgets" title="Refresh">&#x21bb;</button></div></div>
  <div class="stats-row" id="budgetStats"></div>
  <div class="card"><div class="card-header"><span class="card-title">Budget Status</span></div><div id="budgetList"><div class="loading">Loading...</div></div></div>
</div>

<!-- RECURRING PAGE -->
<div class="page" id="pg-recurring">
  <div class="page-header"><div><h1 class="page-title">Recurring Expenses</h1><p class="page-subtitle">Manage your recurring bills</p></div>
    <div style="display:flex;gap:8px"><button class="btn btn-gold btn-sm" id="addRecurringBtn">+ Add Recurring</button><button class="btn-refresh" id="refreshRecurring" title="Refresh">&#x21bb;</button></div></div>
  <div class="stats-row" id="recurringStats"></div>
  <div class="card"><div class="card-header"><span class="card-title">Upcoming Bills</span></div><div id="recurringUpcoming"><div class="loading">Loading...</div></div></div>
  <div class="card"><div class="card-header"><span class="card-title">All Recurring</span></div><div id="recurringList"><div class="loading">Loading...</div></div></div>
</div>

<!-- TAX PAGE -->
<div class="page" id="pg-tax">
  <div class="page-header"><div><h1 class="page-title">Tax Center</h1><p class="page-subtitle" id="taxYearLabel">2026 Tax Year</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <select class="filter-select" id="taxYearSelect"></select>
      <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" id="taxSettingsBtn">Settings</button>
      <button class="btn-refresh" id="refreshTax" title="Refresh">&#x21bb;</button></div></div>
  <div class="stats-row" id="taxStats"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px" id="taxGrid">
    <div class="card"><div class="card-header"><span class="card-title">Deductible Expenses</span></div><div id="taxDeductibles"><div class="loading">Loading...</div></div></div>
    <div class="card"><div class="card-header"><span class="card-title">Quarterly Estimates</span></div><div id="taxQuarters"><div class="loading">Loading...</div></div></div>
  </div>
</div>


</div>

<!-- RECEIPT DETAIL PANEL -->
<div class="detail-panel" id="detailPanel">
  <div class="detail-header" style="flex-direction:column;align-items:stretch;gap:10px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 id="detailTitle" style="font-family:var(--font-display);font-size:1.1rem;color:var(--navy);margin:0">Receipt</h2>
      <button class="modal-close" id="closeDetail">&times;</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" id="viewReceiptBtn">View</button>
      <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" id="editReceiptBtn">Edit</button>
      <button class="btn btn-sm btn-outline" style="color:var(--navy);border-color:var(--cream-dark)" id="makeRecurringBtn">Recurring</button>
      <button class="btn btn-sm btn-danger" id="deleteReceiptBtn">Delete</button>
    </div>
  </div>
  <div class="detail-content" id="detailContent"></div>
</div>

<!-- MODALS -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal" id="modal">
    <div class="modal-header"><h2 id="modalTitle"></h2><button class="modal-close" id="modalClose">&times;</button></div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer" id="modalFooter"></div>
  </div>
</div>

<!-- ONBOARDING WIZARD -->
<div class="modal-overlay" id="onbOverlay">
  <div class="onb-card">
    <button class="onb-x" id="onbClose" type="button" aria-label="Close">&times;</button>
    <div class="onb-dots"><span class="onb-dot" id="onbDot0"></span><span class="onb-dot" id="onbDot1"></span><span class="onb-dot" id="onbDot2"></span></div>
    <h2 id="onbTitle"></h2>
    <p id="onbBody"></p>
    <div class="onb-actions">
      <button class="onb-skip" id="onbSkip" type="button">Skip for now</button>
      <span class="spacer"></span>
      <button class="onb-btn ghost" id="onbBack" type="button">Back</button>
      <button class="onb-btn ghost" id="onbNext" type="button">Next</button>
      <button class="onb-btn" id="onbGo" type="button">Take me there</button>
    </div>
  </div>
</div>

<!-- UPLOAD MODAL -->
<div class="modal-overlay" id="uploadOverlay">
  <div class="modal">
    <div class="modal-header"><h2>Upload Receipt Image</h2><button class="modal-close" id="uploadClose">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Book</label><select class="form-select" id="uploadBook"></select></div>
      <div class="form-group"><label>Receipt Files (images or PDFs)</label><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple id="uploadFile" class="form-input"></div>
      <div id="uploadPreview" style="margin-top:12px"></div>
      <div class="form-error" id="uploadError"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-gold" id="uploadSubmit">Upload &amp; Analyze</button></div>
  </div>
</div>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<script>
(function(){
var T=localStorage.getItem('wl_token'),E=localStorage.getItem('wl_email'),U=null;
var books=[],curBook=null,receipts=[],curPage=1,totalPages=1,summary=null,selReceipt=null;
var isReg=false,selExportFmt='csv';
var CATS=['Education & Training','Entertainment','Food & Dining','Health & Medical','Insurance','Marketing & Advertising','Office Supplies','Other','Professional Services','Rent & Lease','Repairs & Maintenance','Shipping & Postage','Subscriptions','Taxes & Fees','Technology','Transportation','Travel','Utilities'];
var CAT_COLORS=['#c9a84c','#4a90d9','#e07b39','#7b68ee','#2ecc71','#f39c12','#e74c3c','#1abc9c','#9b59b6','#34495e','#e67e22','#3498db','#27ae60','#e74c3c','#8e44ad','#16a085','#d35400','#95a5a6'];

// DOM
var $=function(s){return document.getElementById(s)};
var qa=function(s){return document.querySelectorAll(s)};

// Minimal QR code generator (mode byte, ECC L, version auto) — no external deps
function generateQR(canvas,text,size){
  // Encode text to byte-mode QR using qrcodegen-lite approach
  var EC_L=1;
  function numCharCountBits(v){return v<=9?8:16}
  function makeBytes(s){var b=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<128)b.push(c);else if(c<2048){b.push(192|(c>>6),128|(c&63))}else{b.push(224|(c>>12),128|((c>>6)&63),128|(c&63))}}return b}
  var dataBytes=makeBytes(text);
  // Determine version
  var ver=1,capL=[0,19,34,55,80,108,136,156,194,232,274,324,370,428,461,523,589,647,721,795,861];
  for(ver=1;ver<=20;ver++){if(dataBytes.length<=capL[ver])break}
  if(ver>20)throw new Error('Data too long');
  var totalCodewords=capL[ver]+([0,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28][ver]||0);
  // Actually use a proven tiny QR lib approach — draw via SVG fallback
  // Use the built-in approach: generate SVG via API-less method
  // Simpler: use a data URL with Google Charts-like approach but LOCAL
  // Actually just generate an SVG QR code using the qr-creator pattern
  // For reliability, use an SVG-based QR from the otpauth URL
  var svgNs='http://www.w3.org/2000/svg';
  // Use a well-tested minimal QR encoder
  var QR=function(){
    var PAD0=236,PAD1=17;
    function QRCode(text,ecl){
      this.modules=null;this.moduleCount=0;this.typeNumber=0;this.errorCorrectLevel=ecl||1;
      this.data=text;this.make()
    }
    QRCode.prototype={
      make:function(){
        this.typeNumber=0;
        for(var t=1;t<=40;t++){
          var rs=rsBlocks(t,this.errorCorrectLevel),totalDc=0;
          for(var i=0;i<rs.length;i++)totalDc+=rs[i].dataCount;
          if(this.data.length+(t<=9?3:4)<=totalDc*8){this.typeNumber=t;break}
        }
        if(this.typeNumber===0)throw new Error('Data too long');
        this.moduleCount=this.typeNumber*4+17;
        this.modules=[];
        for(var r=0;r<this.moduleCount;r++){
          this.modules[r]=[];for(var c=0;c<this.moduleCount;c++)this.modules[r][c]=null
        }
        this.setupPositionProbePattern(0,0);
        this.setupPositionProbePattern(this.moduleCount-7,0);
        this.setupPositionProbePattern(0,this.moduleCount-7);
        this.setupPositionAdjustPattern();
        this.setupTimingPattern();
        this.setupTypeInfo(false,0);
        if(this.typeNumber>=7)this.setupTypeNumber(false);
        var data=createData(this.typeNumber,this.errorCorrectLevel,this.data);
        this.mapData(data,0)
      },
      setupPositionProbePattern:function(row,col){
        for(var r=-1;r<=7;r++){
          if(row+r<=-1||this.moduleCount<=row+r)continue;
          for(var c=-1;c<=7;c++){
            if(col+c<=-1||this.moduleCount<=col+c)continue;
            this.modules[row+r][col+c]=
              (0<=r&&r<=6&&(c===0||c===6))||
              (0<=c&&c<=6&&(r===0||r===6))||
              (2<=r&&r<=4&&2<=c&&c<=4)
          }
        }
      },
      setupPositionAdjustPattern:function(){
        var pos=patternPosition(this.typeNumber);
        for(var i=0;i<pos.length;i++){
          for(var j=0;j<pos.length;j++){
            var row=pos[i],col=pos[j];
            if(this.modules[row][col]!==null)continue;
            for(var r=-2;r<=2;r++){
              for(var c=-2;c<=2;c++){
                this.modules[row+r][col+c]=r===-2||r===2||c===-2||c===2||(r===0&&c===0)
              }
            }
          }
        }
      },
      setupTimingPattern:function(){
        for(var r=8;r<this.moduleCount-8;r++){
          if(this.modules[r][6]!==null)continue;
          this.modules[r][6]=r%2===0
        }
        for(var c=8;c<this.moduleCount-8;c++){
          if(this.modules[6][c]!==null)continue;
          this.modules[6][c]=c%2===0
        }
      },
      setupTypeInfo:function(test,maskPattern){
        var data=(this.errorCorrectLevel<<3)|maskPattern;
        var bits=bchTypeInfo(data);
        for(var i=0;i<15;i++){
          var mod=(!test&&((bits>>i)&1)===1);
          if(i<6)this.modules[i][8]=mod;
          else if(i<8)this.modules[i+1][8]=mod;
          else this.modules[this.moduleCount-15+i][8]=mod
        }
        for(var i=0;i<15;i++){
          var mod=(!test&&((bits>>i)&1)===1);
          if(i<8)this.modules[8][this.moduleCount-i-1]=mod;
          else if(i<9)this.modules[8][15-i-1+1]=mod;
          else this.modules[8][15-i-1]=mod
        }
        this.modules[this.moduleCount-8][8]=!test
      },
      setupTypeNumber:function(test){
        var bits=bchTypeNumber(this.typeNumber);
        for(var i=0;i<18;i++){
          var mod=(!test&&((bits>>i)&1)===1);
          this.modules[Math.floor(i/3)][i%3+this.moduleCount-8-3]=mod
        }
        for(var i=0;i<18;i++){
          var mod=(!test&&((bits>>i)&1)===1);
          this.modules[i%3+this.moduleCount-8-3][Math.floor(i/3)]=mod
        }
      },
      mapData:function(data,maskPattern){
        var inc=-1,row=this.moduleCount-1,bitIndex=7,byteIndex=0;
        for(var col=this.moduleCount-1;col>0;col-=2){
          if(col===6)col--;
          while(true){
            for(var c=0;c<2;c++){
              if(this.modules[row][col-c]===null){
                var dark=false;
                if(byteIndex<data.length)dark=((data[byteIndex]>>bitIndex)&1)===1;
                var mask=getMask(maskPattern,row,col-c);
                if(mask)dark=!dark;
                this.modules[row][col-c]=dark;
                bitIndex--;
                if(bitIndex===-1){byteIndex++;bitIndex=7}
              }
            }
            row+=inc;
            if(row<0||this.moduleCount<=row){row-=inc;inc=-inc;break}
          }
        }
      }
    };
    function getMask(mp,i,j){
      switch(mp){
        case 0:return(i+j)%2===0;
        case 1:return i%2===0;
        case 2:return j%3===0;
        case 3:return(i+j)%3===0;
        case 4:return(Math.floor(i/2)+Math.floor(j/3))%2===0;
        case 5:return(i*j)%2+(i*j)%3===0;
        case 6:return((i*j)%2+(i*j)%3)%2===0;
        case 7:return((i*j)%3+(i+j)%2)%2===0
      }
    }
    function bchTypeInfo(data){
      var d=data<<10;while(bchDigit(d)-bchDigit(1335)>=0)d^=(1335<<(bchDigit(d)-bchDigit(1335)));
      return((data<<10)|d)^21522
    }
    function bchTypeNumber(data){
      var d=data<<12;while(bchDigit(d)-bchDigit(7973)>=0)d^=(7973<<(bchDigit(d)-bchDigit(7973)));
      return(data<<12)|d
    }
    function bchDigit(data){var digit=0;while(data!==0){digit++;data>>>=1}return digit}
    function patternPosition(t){
      if(t===1)return[];
      var p=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90]];
      return p[t-1]||[]
    }
    function rsBlocks(t,ecl){
      var RS_BLOCK_TABLE=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17]];
      var idx=(t-1)*4+ecl;if(idx>=RS_BLOCK_TABLE.length)idx=RS_BLOCK_TABLE.length-1;
      var d=RS_BLOCK_TABLE[idx],result=[];
      for(var i=0;i<d.length;i+=3){
        var count=d[i],total=d[i+1],dc=d[i+2];
        for(var j=0;j<count;j++)result.push({totalCount:total,dataCount:dc})
      }
      return result
    }
    function createData(typeNumber,errorCorrectLevel,text){
      var rsB=rsBlocks(typeNumber,errorCorrectLevel);
      var buffer=new BitBuffer();
      buffer.put(4,4);// byte mode
      buffer.put(text.length,numCharCountBits(typeNumber));
      var bytes=makeBytes(text);
      for(var i=0;i<bytes.length;i++)buffer.put(bytes[i],8);
      var totalDc=0;for(var i=0;i<rsB.length;i++)totalDc+=rsB[i].dataCount;
      if(buffer.length>totalDc*8)throw new Error('Data too long');
      if(buffer.length+4<=totalDc*8)buffer.put(0,4);
      while(buffer.length%8!==0)buffer.putBit(false);
      while(true){
        if(buffer.length>=totalDc*8)break;buffer.put(PAD0,8);
        if(buffer.length>=totalDc*8)break;buffer.put(PAD1,8)
      }
      return createBytes(buffer,rsB)
    }
    function createBytes(buffer,rsBlocks){
      var offset=0,maxDcCount=0,maxEcCount=0;
      var dcdata=[],ecdata=[];
      for(var r=0;r<rsBlocks.length;r++){
        var dcCount=rsBlocks[r].dataCount;
        var ecCount=rsBlocks[r].totalCount-dcCount;
        maxDcCount=Math.max(maxDcCount,dcCount);
        maxEcCount=Math.max(maxEcCount,ecCount);
        dcdata[r]=[];
        for(var i=0;i<dcCount;i++)dcdata[r][i]=0xff&buffer.getByte(i+offset);
        offset+=dcCount;
        var rsPoly=getErrorCorrectPolynomial(ecCount);
        var rawPoly=new Polynomial(dcdata[r],rsPoly.getLength()-1);
        var modPoly=rawPoly.mod(rsPoly);
        ecdata[r]=[];
        for(var i=0;i<rsPoly.getLength()-1;i++){
          var modIndex=i+modPoly.getLength()-rsPoly.getLength()+1;
          ecdata[r][i]=(modIndex>=0)?modPoly.get(modIndex):0
        }
      }
      var totalCodeCount=0;for(var i=0;i<rsBlocks.length;i++)totalCodeCount+=rsBlocks[i].totalCount;
      var data=[];var index=0;
      for(var i=0;i<maxDcCount;i++){
        for(var r=0;r<rsBlocks.length;r++){
          if(i<dcdata[r].length)data[index++]=dcdata[r][i]
        }
      }
      for(var i=0;i<maxEcCount;i++){
        for(var r=0;r<rsBlocks.length;r++){
          if(i<ecdata[r].length)data[index++]=ecdata[r][i]
        }
      }
      return data
    }
    var EXP_TABLE=[],LOG_TABLE=[];
    (function(){
      for(var i=0;i<256;i++){EXP_TABLE[i]=(i<8)?1<<i:EXP_TABLE[i-4]^EXP_TABLE[i-5]^EXP_TABLE[i-6]^EXP_TABLE[i-8];LOG_TABLE[EXP_TABLE[i]%255]=i}
    })();
    function gexp(n){while(n<0)n+=255;while(n>=256)n-=255;return EXP_TABLE[n]}
    function glog(n){if(n<1)throw new Error('glog('+n+')');return LOG_TABLE[n]}
    function Polynomial(num,shift){
      var offset=0;while(offset<num.length&&num[offset]===0)offset++;
      this.num=[];for(var i=0;i<num.length-offset+shift;i++)this.num[i]=0;
      for(var i=0;i<num.length-offset;i++)this.num[i]=num[i+offset]
    }
    Polynomial.prototype={
      get:function(i){return this.num[i]},
      getLength:function(){return this.num.length},
      multiply:function(e){
        var num=[];for(var i=0;i<this.getLength()+e.getLength()-1;i++)num[i]=0;
        for(var i=0;i<this.getLength();i++){
          for(var j=0;j<e.getLength();j++){
            num[i+j]^=gexp(glog(this.get(i))+glog(e.get(j)))
          }
        }
        return new Polynomial(num,0)
      },
      mod:function(e){
        if(this.getLength()-e.getLength()<0)return this;
        var ratio=glog(this.get(0))-glog(e.get(0));
        var num=[];for(var i=0;i<this.getLength();i++)num[i]=this.get(i);
        for(var i=0;i<e.getLength();i++)num[i]^=gexp(glog(e.get(i))+ratio);
        return new Polynomial(num,0).mod(e)
      }
    };
    function getErrorCorrectPolynomial(ecLength){
      var a=new Polynomial([1],0);
      for(var i=0;i<ecLength;i++)a=a.multiply(new Polynomial([1,gexp(i)],0));
      return a
    }
    function BitBuffer(){this.buffer=[];this.length=0}
    BitBuffer.prototype={
      getByte:function(i){return this.buffer[Math.floor(i/8)]},
      put:function(num,length){for(var i=0;i<length;i++)this.putBit(((num>>>(length-i-1))&1)===1)},
      putBit:function(bit){
        var bufIndex=Math.floor(this.length/8);
        if(this.buffer.length<=bufIndex)this.buffer.push(0);
        if(bit)this.buffer[bufIndex]|=(0x80>>>(this.length%8));
        this.length++
      }
    };
    return QRCode
  }();
  var qr=new QR(text,0);
  var mc=qr.moduleCount;
  var cellSize=Math.floor(size/mc);
  canvas.width=cellSize*mc;canvas.height=cellSize*mc;
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0a1628';
  for(var r=0;r<mc;r++){
    for(var c=0;c<mc;c++){
      if(qr.modules[r][c])ctx.fillRect(c*cellSize,r*cellSize,cellSize,cellSize)
    }
  }
}
function el(t,a,c){
  var n=document.createElement(t);
  if(a)Object.keys(a).forEach(function(k){
    if(k==='onclick')n.addEventListener('click',a[k]);
    else if(k==='className')n.className=a[k];
    else if(k==='style'&&typeof a[k]==='object')Object.assign(n.style,a[k]);
    else if(k==='disabled'){if(a[k])n.setAttribute('disabled','');else n.removeAttribute('disabled')}
    else n.setAttribute(k,a[k]);
  });
  if(typeof c==='string')n.textContent=c;
  else if(Array.isArray(c))c.forEach(function(x){if(x)n.appendChild(x)});
  return n;
}

function fmt(a){if(a==null)return'--';var f=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});return f.format(a)}
function fmtDate(d){if(!d)return'--';try{var hasTime=d.includes('T')||d.includes(' ');var s=hasTime?d.replace(' ','T'):d+'T00:00:00';if(!s.endsWith('Z')&&s.indexOf('+')===-1)s+='Z';var p=new Date(s);if(isNaN(p.getTime()))return d;var opts={month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'};if(hasTime){opts.hour='numeric';opts.minute='2-digit'}return p.toLocaleString('en-US',opts)}catch(e){return d}}
function toast(msg,type){var t=$('toast');t.textContent=msg;t.className='toast toast-'+(type||'success')+' show';setTimeout(function(){t.className='toast'},3000)}

// AUTH
$('loginForm').addEventListener('submit',function(e){
  e.preventDefault();
  var btn=$('loginBtn'),err=$('loginError');err.style.display='none';btn.disabled=true;btn.textContent='Please wait...';
  var mfaCode=document.getElementById('mfaCode');
  var body=isReg?{email:$('loginEmail').value,password:$('loginPass').value,name:$('regName').value}:{email:$('loginEmail').value,password:$('loginPass').value};
  if(mfaCode)body.mfa_code=mfaCode.value;
  fetch('/api/auth/'+(isReg?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
  .then(function(r){
    if(!r.ok)throw new Error(r.data.error||'Failed');
    if(r.data.mfa_required){showMfaPrompt();return}
    T=r.data.token||r.data.data?.token;E=$('loginEmail').value;
    localStorage.setItem('wl_token',T);localStorage.setItem('wl_email',E);
    showApp();
  })
  .catch(function(e){err.textContent=e.message;err.style.display='block'})
  .finally(function(){btn.disabled=false;btn.textContent=isReg?'Create Account':'Sign In'});
});
function setAuthMode(reg){
  isReg=reg;
  document.getElementById('nameGroup').style.display=reg?'':'none';
  document.getElementById('authTitle').textContent=reg?'Create your account':'Welcome back';
  document.getElementById('authDesc').textContent=reg?'Set up your ledger — this first account is the owner.':'Sign in to your ledger.';
  $('loginBtn').textContent=reg?'Create Account':'Sign In';
  var t=document.getElementById('registerToggle');if(t)t.textContent=reg?'Have an account? Sign in':'Create an account';
  var pr=document.getElementById('passkeyRow');if(pr&&window.PublicKeyCredential)pr.style.display=reg?'none':'';
  var f=document.getElementById('loginError');if(f)f.style.display='none';
  if(reg){var rn=document.getElementById('regName');if(rn)rn.focus()}
}
(function initRegistration(){
  var rt=document.getElementById('registerToggle');
  if(rt)rt.addEventListener('click',function(e){e.preventDefault();setAuthMode(!isReg)});
  // Ask the server whether to offer account creation; a brand-new (no-users)
  // instance opens straight into "Create your account".
  fetch('/api/auth/registration-status').then(function(r){return r.json()}).then(function(res){
    var d=(res&&res.data)||res||{};
    if(d.canRegister&&rt)rt.style.display='';
    if(d.canRegister&&!d.hasUsers)setAuthMode(true);
  }).catch(function(){});
})();
function showMfaPrompt(){
  var form=$('loginForm');var existing=document.getElementById('mfaGroup');if(existing)return;
  var group=el('div',{id:'mfaGroup',className:'form-group',style:{marginBottom:'18px'}},[
    el('label',{for:'mfaCode'},'AUTHENTICATOR CODE'),
    el('input',{className:'form-input',type:'text',id:'mfaCode',placeholder:'Enter 6-digit code',maxlength:'6',autocomplete:'one-time-code',style:{textAlign:'center',fontSize:'1.1rem',letterSpacing:'.2em'}})
  ]);
  form.insertBefore(group,$('loginBtn'));
  $('loginBtn').textContent='Verify & Sign In';
  document.getElementById('mfaCode').focus();
}
// PASSKEYS (WebAuthn)
function bufToB64url(buf){var bytes=new Uint8Array(buf),bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function b64urlToBuf(s){var b=s.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';var bin=atob(b),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes.buffer}
if(window.PublicKeyCredential)$('passkeyRow').style.display='';
// Send an assertion to the server and start the session. Shared by the explicit
// button and the conditional-UI (autofill) path.
async function completePasskeyLogin(cred,challengeId){
  var vr=await fetch('/api/auth/passkeys/login/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    challenge_id:challengeId,
    credential:{id:cred.id,response:{
      clientDataJSON:bufToB64url(cred.response.clientDataJSON),
      authenticatorData:bufToB64url(cred.response.authenticatorData),
      signature:bufToB64url(cred.response.signature),
      userHandle:cred.response.userHandle?bufToB64url(cred.response.userHandle):null
    }}
  })});
  var v=await vr.json();if(!vr.ok)throw new Error(v.error||'Passkey sign-in failed');
  T=v.token;E=v.user&&v.user.email||'';
  localStorage.setItem('wl_token',T);localStorage.setItem('wl_email',E);
  showApp();
}
async function passkeyOptions(){
  var r=await fetch('/api/auth/passkeys/login/options',{method:'POST'});
  var o=await r.json();if(!r.ok)throw new Error(o.error||'Failed to start passkey sign-in');
  return o.data;
}
// Explicit "Sign in with a passkey" button (modal mediation).
$('passkeyLoginBtn').addEventListener('click',async function(){
  var btn=this,err=$('loginError');err.style.display='none';btn.disabled=true;btn.textContent='Waiting for your passkey...';
  try{
    var d=await passkeyOptions();var opts=d.publicKey;
    var cred=await navigator.credentials.get({publicKey:{
      challenge:b64urlToBuf(opts.challenge),rpId:opts.rpId,timeout:opts.timeout,
      userVerification:opts.userVerification,allowCredentials:[]
    }});
    await completePasskeyLogin(cred,d.challenge_id);
  }catch(e){
    if(e.name!=='NotAllowedError'&&e.name!=='AbortError'){err.textContent=e.message;err.style.display='block'}
  }finally{btn.disabled=false;btn.innerHTML='\\uD83D\\uDD11 Sign in with a passkey'}
});
// Conditional UI: if the browser + a passkey provider (1Password, iCloud, etc.)
// support autofill, offer saved passkeys right in the email field — no button
// press needed. The request stays pending until the user picks one or submits
// the password form normally; NotAllowedError/AbortError just means they went
// another way, so it is swallowed silently.
(async function initConditionalPasskey(){
  try{
    if(!window.PublicKeyCredential||!PublicKeyCredential.isConditionalMediationAvailable)return;
    if(!(await PublicKeyCredential.isConditionalMediationAvailable()))return;
    var d=await passkeyOptions();var opts=d.publicKey;
    var cred=await navigator.credentials.get({
      mediation:'conditional',
      publicKey:{challenge:b64urlToBuf(opts.challenge),rpId:opts.rpId,timeout:opts.timeout,userVerification:opts.userVerification,allowCredentials:[]}
    });
    if(cred)await completePasskeyLogin(cred,d.challenge_id);
  }catch(e){ /* user chose password/another method, or no passkey — ignore */ }
})();
// A friendly default like "Chrome on macOS" so a new passkey is named without
// interrupting the create ceremony with a browser prompt. Renameable in the list.
function defaultPasskeyName(){
  var ua=navigator.userAgent||'';
  var os='this device';
  if(/iPhone|iPad|iPod/.test(ua))os='iPhone/iPad';
  else if(/Macintosh|Mac OS X/.test(ua))os='macOS';
  else if(/Windows/.test(ua))os='Windows';
  else if(/Android/.test(ua))os='Android';
  else if(/Linux/.test(ua))os='Linux';
  var br='Browser';
  if(/Edg\\//.test(ua))br='Edge';
  else if(/OPR\\//.test(ua))br='Opera';
  else if(/Chrome\\//.test(ua))br='Chrome';
  else if(/Firefox\\//.test(ua))br='Firefox';
  else if(/Safari\\//.test(ua))br='Safari';
  return br+' on '+os;
}
async function loadPasskeys(){
  var c=$('passkeysList');if(!c)return;
  if(!window.PublicKeyCredential){c.replaceChildren(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',fontStyle:'italic'}},'This browser does not support passkeys.'));$('addPasskeyBtn').style.display='none';return}
  try{
    var list=await api('/api/auth/passkeys');
    c.replaceChildren();
    if(!list.length){c.appendChild(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',padding:'4px 0',fontStyle:'italic'}},'No passkeys yet.'));return}
    list.forEach(function(pk){
      var nameSpan=el('span',{className:'share-name'},pk.nickname||'Passkey');
      var info=el('div',{className:'share-info'},[
        nameSpan,
        el('span',{className:'share-email'},'Added '+fmtDate(pk.created_at)+(pk.last_used_at?' \\u00b7 Last used '+fmtDate(pk.last_used_at):' \\u00b7 Never used'))
      ]);
      function startRename(){
        var input=el('input',{className:'form-input',value:pk.nickname||'',style:{fontSize:'.85rem',padding:'4px 8px'}});
        async function commit(){
          var name=input.value.trim();if(!name||name===pk.nickname){loadPasskeys();return}
          try{await api('/api/auth/passkeys/'+pk.id,{method:'PATCH',body:{nickname:name}});toast('Passkey renamed');loadPasskeys()}
          catch(e){toast(e.message,'error');loadPasskeys()}
        }
        input.addEventListener('keydown',function(ev){if(ev.key==='Enter')commit();else if(ev.key==='Escape')loadPasskeys()});
        input.addEventListener('blur',commit);
        info.replaceChild(input,nameSpan);input.focus();input.select();
      }
      c.appendChild(el('div',{className:'share-item'},[
        info,
        el('div',{style:{display:'flex',gap:'6px'}},[
          el('button',{className:'btn btn-sm',style:{fontSize:'.7rem',padding:'2px 8px'},onclick:startRename},'Rename'),
          el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.7rem',padding:'2px 8px'},onclick:async function(){
            if(!confirm('Remove this passkey? You will no longer be able to sign in with it.'))return;
            try{await api('/api/auth/passkeys/'+pk.id,{method:'DELETE'});toast('Passkey removed');loadPasskeys()}catch(e){toast(e.message,'error')}
          }},'Remove')
        ])
      ]));
    });
  }catch(e){c.replaceChildren(el('p',{style:{fontSize:'.85rem',color:'var(--red)'}},e.message))}
}
$('addPasskeyBtn').addEventListener('click',async function(){
  var btn=this;btn.disabled=true;btn.textContent='Follow your browser prompts...';
  try{
    var o=await api('/api/auth/passkeys/register/options',{method:'POST',body:{}});
    var opts=o.publicKey;
    var cred=await navigator.credentials.create({publicKey:{
      rp:opts.rp,
      user:{id:b64urlToBuf(opts.user.id),name:opts.user.name,displayName:opts.user.displayName},
      challenge:b64urlToBuf(opts.challenge),
      pubKeyCredParams:opts.pubKeyCredParams,
      timeout:opts.timeout,
      excludeCredentials:(opts.excludeCredentials||[]).map(function(c){return{type:c.type,id:b64urlToBuf(c.id),transports:c.transports}}),
      authenticatorSelection:opts.authenticatorSelection,
      attestation:opts.attestation
    }});
    await api('/api/auth/passkeys/register/verify',{method:'POST',body:{
      challenge_id:o.challenge_id,
      nickname:defaultPasskeyName(),
      credential:{id:cred.id,response:{
        clientDataJSON:bufToB64url(cred.response.clientDataJSON),
        attestationObject:bufToB64url(cred.response.attestationObject),
        transports:cred.response.getTransports?cred.response.getTransports():[]
      }}
    }});
    toast('Passkey added');loadPasskeys();
  }catch(e){
    if(e.name!=='NotAllowedError'&&e.name!=='AbortError')toast(e.message,'error');
  }finally{btn.disabled=false;btn.textContent='+ Add a Passkey'}
});
$('logoutBtn').addEventListener('click',function(){T=null;E=null;U=null;localStorage.removeItem('wl_token');localStorage.removeItem('wl_email');
  $('landing').style.display='';$('app').style.display='none'});

// Forgot password
$('forgotPassLink').addEventListener('click',function(e){
  e.preventDefault();
  $('loginForm').style.display='none';
  $('forgotPassLink').style.display='none';
  $('forgotPassForm').style.display='';
});
$('backToLogin').addEventListener('click',function(e){
  e.preventDefault();
  $('loginForm').style.display='';
  $('forgotPassLink').style.display='';
  $('forgotPassForm').style.display='none';
  $('forgotError').style.display='none';
  $('forgotSuccess').style.display='none';
});
$('forgotBtn').addEventListener('click',function(){
  var btn=this,email=$('forgotEmail').value;
  if(!email)return;
  btn.disabled=true;btn.textContent='Sending...';
  $('forgotError').style.display='none';$('forgotSuccess').style.display='none';
  fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})})
  .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
  .then(function(r){
    if(!r.ok)throw new Error(r.data.error||'Failed');
    $('forgotSuccess').textContent=r.data.message||'If an account exists, a reset link has been sent.';
    $('forgotSuccess').style.display='block';
    $('forgotBtn').style.display='none';
  })
  .catch(function(e){$('forgotError').textContent=e.message;$('forgotError').style.display='block'})
  .finally(function(){btn.disabled=false;btn.textContent='Send Reset Link'});
});

// Reset password (from email link)
$('resetBtn').addEventListener('click',function(){
  var btn=this,pass=$('resetNewPass').value,confirm=$('resetConfirmPass').value;
  $('resetError').style.display='none';$('resetSuccess').style.display='none';
  if(!pass||pass.length<8){$('resetError').textContent='Password must be at least 8 characters';$('resetError').style.display='block';return}
  if(pass!==confirm){$('resetError').textContent='Passwords do not match';$('resetError').style.display='block';return}
  var params=new URLSearchParams(window.location.search);
  var token=params.get('reset_token'),email=params.get('email');
  if(!token||!email){$('resetError').textContent='Invalid reset link';$('resetError').style.display='block';return}
  btn.disabled=true;btn.textContent='Resetting...';
  fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,token:token,new_password:pass})})
  .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
  .then(function(r){
    if(!r.ok)throw new Error(r.data.error||'Failed');
    $('resetSuccess').textContent='Password reset successfully! Redirecting to login...';
    $('resetSuccess').style.display='block';
    $('resetBtn').style.display='none';
    setTimeout(function(){window.location.href='/'},2000);
  })
  .catch(function(e){$('resetError').textContent=e.message;$('resetError').style.display='block'})
  .finally(function(){btn.disabled=false;btn.textContent='Reset Password'});
});

// Check for reset token in URL on page load
(function(){
  var params=new URLSearchParams(window.location.search);
  if(params.get('reset_token')&&params.get('email')){
    $('loginForm').style.display='none';
    $('forgotPassLink').style.display='none';
      $('resetPassForm').style.display='';
  }
})();

async function api(path,opts){
  var o=Object.assign({headers:{'Authorization':'Bearer '+T}},opts||{});
  if(o.body&&typeof o.body==='object'&&!(o.body instanceof FormData)){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body)}
  var r=await fetch(path,o);
  if(r.status===401){$('logoutBtn').click();throw new Error('Session expired')}
  var d=await r.json();
  if(!r.ok)throw new Error(d.error||'Request failed');
  return d.data!==undefined?d.data:d;
}

// NAV
qa('.app-nav-links a').forEach(function(a){a.addEventListener('click',function(e){
  e.preventDefault();var pg=this.dataset.page;navigate(pg)})});
function navigate(pg){
  qa('.page').forEach(function(p){p.classList.remove('active')});
  var p=$('pg-'+pg);if(p)p.classList.add('active');
  qa('.app-nav-links a').forEach(function(a){a.classList.toggle('active',a.dataset.page===pg)});
  var keepSub=(pg==='settings'&&location.hash.indexOf('#settings/')===0);
  if(!keepSub&&location.hash!=='#'+pg)history.replaceState(null,'','#'+pg);
  if(pg==='dashboard')loadDashboard();
  if(pg==='expenses')loadReceipts();
  if(pg==='reports')loadReports();
  if(pg==='income')loadIncome();
  if(pg==='subscriptions')loadSubscriptions();
  if(pg==='budgets')loadBudgets();
  if(pg==='recurring')loadRecurring();
  if(pg==='tax')loadTax();
  if(pg==='settings')loadSettings();
  closeDetailPanel();
}

// Settings sub-tabs
qa('.settings-tab').forEach(function(t){t.addEventListener('click',function(e){
  e.preventDefault();var tab=this.dataset.stab;switchSettingsTab(tab)})});
function switchSettingsTab(tab){
  history.replaceState(null,'','#settings/'+tab);
  qa('.settings-tab').forEach(function(t){t.classList.toggle('active',t.dataset.stab===tab)});
  qa('.settings-panel').forEach(function(p){p.classList.remove('active')});
  var p=$('stab-'+tab);if(p)p.classList.add('active');
  if(tab==='books')loadBooks();
  if(tab==='export')loadExportPage();
  if(tab==='integrations')loadIntegrations();
}

async function showApp(){
  $('landing').style.display='none';$('app').style.display='block';$('appEmail').textContent=E||'';
  try{U=await api('/api/auth/profile');$('appEmail').textContent=U.name||U.email||E}catch(e){}
  await fetchBooks();
  if(U && !U.onboarding_completed && books.length===0){ openOnboarding(); }
  var raw=location.hash.replace('#','').split('?')[0];
  var parts=raw.split('/');
  var h=parts[0];
  var validPages=['dashboard','expenses','reports','income','subscriptions','budgets','recurring','tax','pnl','settings'];
  navigate(validPages.indexOf(h)!==-1?h:'dashboard');
  if(h==='settings'&&parts[1])switchSettingsTab(parts[1]);
}

async function fetchBooks(){
  try{var d=await api('/api/books');books=[].concat(d.owned||[],d.shared||[])}catch(e){books=[]}
  populateBookSelects();
}

function populateBookSelects(){
  [$('dashBookSelect'),$('receiptBookFilter'),$('exportBookSelect'),$('uploadBook')].forEach(function(sel){
    if(!sel)return;var v=sel.value;
    while(sel.firstChild)sel.removeChild(sel.firstChild);
    if(sel.id!=='uploadBook'){sel.appendChild(el('option',{value:''},'All Books'))}
    books.forEach(function(b){sel.appendChild(el('option',{value:b.id},b.name+(b.status==='closed'?' (closed)':'')))});
    if(v)sel.value=v;
    if(sel.id==='uploadBook'&&books.length)sel.value=books[0].id;
  });
  // Restore the user's last-used book on the Expenses filter (only when nothing
  // is selected yet, i.e. initial load) so creating a new book doesn't hijack it.
  var rf=$('receiptBookFilter');
  if(rf&&rf.value===''){var saved=localStorage.getItem('wl_book');if(saved&&books.find(function(b){return b.id===saved}))rf.value=saved;}
  CATS.forEach(function(c){
    [$('categoryFilter'),$('exportCategory')].forEach(function(sel){
      if(!sel||sel.querySelector('option[value="'+c+'"]'))return;
      sel.appendChild(el('option',{value:c},c));
    });
  });
}

// DASHBOARD — FINANCIAL OVERVIEW
var dashIncomeSummary=null;
async function loadDashboard(){
  var bookId=$('dashBookSelect').value;
  if(!bookId&&books.length)bookId=books[0].id;
  if(!bookId){$('dashStats').replaceChildren(el('div',{className:'empty'},[el('div',{className:'empty-icon'},'\\uD83D\\uDCCA'),el('p',null,'Create a book to see your dashboard.'),el('button',{className:'btn btn-gold',style:{marginTop:'12px'},onclick:function(){showBookModal()}},'+ Create a book')]));return}
  $('dashBookSelect').value=bookId;
  try{
    var [expSummary,incSummary,rc]=await Promise.all([
      api('/api/books/'+encodeURIComponent(bookId)+'/summary'),
      api('/api/income/summary').catch(function(){return{overview:{total_cents:0,net_cents:0,fee_cents:0,count:0},by_source:[],by_month:[]}}),
      api('/api/books/'+encodeURIComponent(bookId)+'/receipts?limit=10')
    ]);
    summary=expSummary;dashIncomeSummary=incSummary;
    renderDashStats(expSummary,incSummary);renderCombinedChart(expSummary.by_month||[],incSummary.by_month||[]);
    renderCatList(expSummary.by_category||[]);renderDashSourceList(incSummary.by_source||[]);
    renderRecentActivity(rc.receipts||rc||[]);
    loadPnl();
  }catch(e){$('dashStats').replaceChildren(el('p',{className:'loading'},e.message))}
}
$('dashBookSelect').addEventListener('change',loadDashboard);
$('refreshDash').addEventListener('click',function(){this.classList.add('spinning');loadDashboard().finally(()=>this.classList.remove('spinning'))});

function renderDashStats(exp,inc){
  var eo=exp.overview||{};
  var io=inc.overview||{};
  var totalRevenue=(io.total_cents||0)/100;
  var totalExpenses=eo.total||0;
  var netProfit=totalRevenue-totalExpenses;
  var profitColor=netProfit>=0?'var(--green)':'var(--red)';
  var profitLabel=netProfit>=0?'Net Profit':'Net Loss';
  var thisMonthExp=getThisMonthTotal(exp.by_month||[]);
  var thisMonthRev=getThisMonthRevenue(inc.by_month||[]);
  $('dashStats').replaceChildren(
    statCard('Total Revenue',fmt(totalRevenue),(io.count||0)+' transactions','var(--green)'),
    statCard('Total Expenses',fmt(totalExpenses),(eo.count||0)+' receipts','var(--gold-dim)'),
    statCard(profitLabel,fmt(Math.abs(netProfit)),netProfit>=0?'positive margin':'spending exceeds revenue',profitColor),
    statCard('This Month',fmt(thisMonthRev-thisMonthExp),'Rev '+fmt(thisMonthRev)+' / Exp '+fmt(thisMonthExp),thisMonthRev-thisMonthExp>=0?'var(--green)':'var(--red)')
  );
}
function statCard(label,value,sub,accent){
  var card=el('div',{className:'stat-card'},[el('div',{className:'stat-label'},label),el('div',{className:'stat-value'},value),el('div',{className:'stat-sub'},sub)]);
  if(accent)card.querySelector('.stat-value').style.color=accent;
  return card;
}
function getThisMonthTotal(months){
  var now=new Date(),key=now.getFullYear()+'-'+(''+(now.getMonth()+1)).padStart(2,'0');
  var m=months.find(function(x){return x.month===key});return m?m.total:0;
}
function getThisMonthRevenue(months){
  var now=new Date(),key=now.getFullYear()+'-'+(''+(now.getMonth()+1)).padStart(2,'0');
  var m=months.find(function(x){return x.month===key});return m?(m.total_cents||0)/100:0;
}
function renderCombinedChart(expMonths,incMonths){
  var c=$('monthlyChart');c.replaceChildren();
  // Build combined month set
  var monthMap={};
  expMonths.forEach(function(m){if(!monthMap[m.month])monthMap[m.month]={exp:0,rev:0};monthMap[m.month].exp=m.total||0});
  incMonths.forEach(function(m){if(!monthMap[m.month])monthMap[m.month]={exp:0,rev:0};monthMap[m.month].rev=(m.total_cents||0)/100});
  var keys=Object.keys(monthMap).sort().slice(-12);
  if(!keys.length){c.appendChild(el('div',{className:'empty',style:{width:'100%'}},'No data yet'));return}
  var max=Math.max.apply(null,keys.map(function(k){return Math.max(monthMap[k].rev,monthMap[k].exp)}))||1;
  var barH=170;
  // Dynamic bar width based on container: fills available space, capped at 100px
  var chartW=c.offsetWidth||800;
  var groupGap=12;
  var barGap=4;
  // Each month = 2 bars + 1 barGap inside + groupGap between months
  var available=chartW-(keys.length-1)*groupGap-keys.length*barGap;
  var barW=Math.min(100,Math.max(16,Math.floor(available/(keys.length*2))));
  c.style.gap=groupGap+'px';
  keys.forEach(function(k){
    var d=monthMap[k];
    var hRev=Math.max(2,d.rev/max*barH);
    var hExp=Math.max(2,d.exp/max*barH);
    var label=k.slice(5);
    var col=el('div',{className:'bar-col',style:{gap:'2px'}},[
      el('div',{style:{display:'flex',gap:'4px',alignItems:'flex-end',height:barH+'px'}},[
        el('div',{style:{width:barW+'px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',height:'100%'}},[
          el('div',{className:'bar-value',style:{color:'var(--green)',fontSize:'.65rem',whiteSpace:'nowrap'}},'$'+Math.round(d.rev)),
          el('div',{style:{background:'var(--green)',borderRadius:'3px 3px 0 0',width:'100%',height:hRev+'px',minHeight:'2px'}})
        ]),
        el('div',{style:{width:barW+'px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',height:'100%'}},[
          el('div',{className:'bar-value',style:{color:'var(--gold-dim)',fontSize:'.65rem',whiteSpace:'nowrap'}},'$'+Math.round(d.exp)),
          el('div',{style:{background:'var(--gold)',borderRadius:'3px 3px 0 0',width:'100%',height:hExp+'px',minHeight:'2px'}})
        ])
      ]),
      el('div',{className:'bar-label',style:{writingMode:'horizontal-tb'}},label)
    ]);
    c.appendChild(col);
  });
}
function renderCatList(cats){
  var c=$('catList');c.replaceChildren();
  if(!cats.length){c.appendChild(el('li',{className:'empty',style:{padding:'20px'}},'No expense categories yet'));return}
  cats.slice(0,8).forEach(function(cat,i){
    c.appendChild(el('li',{className:'cat-item'},[
      el('span',{className:'cat-dot',style:{background:CAT_COLORS[i%CAT_COLORS.length]}}),
      el('span',{className:'cat-name'},cat.category||'Other'),
      el('span',{className:'cat-amount'},fmt(cat.total)),
      el('span',{className:'cat-count'},cat.count+'x')
    ]));
  });
}
function renderDashSourceList(sources){
  var c=$('dashSourceList');c.replaceChildren();
  var srcColors={'stripe':'#635bff','google_play':'#34a853','apple_app_store':'#007aff'};
  var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'App Store'};
  if(!sources.length){c.appendChild(el('li',{className:'empty',style:{padding:'20px'}},'No revenue data for this period'));return}
  sources.forEach(function(s){
    c.appendChild(el('li',{className:'cat-item'},[
      el('span',{className:'cat-dot',style:{background:srcColors[s.source]||'var(--gold)'}}),
      el('span',{className:'cat-name'},srcNames[s.source]||s.source),
      el('span',{className:'cat-amount'},fmt(s.total_cents/100)),
      el('span',{className:'cat-count'},s.count+'x')
    ]));
  });
}
function renderRecentActivity(recs){
  var t=$('recentActivity');t.replaceChildren();
  if(!recs.length){t.appendChild(el('tr',null,[el('td',{colspan:'5',style:{textAlign:'center',padding:'32px',color:'var(--text-light)'}},'No activity yet')]));return}
  recs.slice(0,10).forEach(function(rc){
    t.appendChild(el('tr',{onclick:function(){openReceipt(rc.book_id,rc.id)}},[
      el('td',null,fmtDate(rc.date)),
      el('td',null,[el('span',{style:{fontSize:'.72rem',fontWeight:'600',padding:'2px 8px',borderRadius:'10px',background:'#fef3cd',color:'var(--gold-dim)'}},'Expense')]),
      el('td',{style:{fontWeight:'500'}},rc.merchant||'--'),
      el('td',null,rc.category||'--'),
      el('td',{style:{fontWeight:'600',fontVariantNumeric:'tabular-nums',color:'var(--red)'}},'-'+fmt(rc.amount))
    ]));
  });
}

// BOOKS
async function loadBooks(){
  await fetchBooks();
  var g=$('booksGrid');g.replaceChildren();
  if(!books.length){g.appendChild(el('div',{className:'empty',style:{gridColumn:'1/-1'}},[el('div',{className:'empty-icon'},'\\uD83D\\uDCD6'),el('p',null,'No books yet. Create your first book!')]));return}
  books.forEach(function(b){
    var card=el('div',{className:'card',style:{cursor:'pointer'},onclick:function(){showBookDetail(b)}},[
      el('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}},[
        el('div',null,[
          el('h3',{style:{fontFamily:'var(--font-display)',fontSize:'1.15rem',color:'var(--navy)',marginBottom:'4px'}},[document.createTextNode(b.name),b.status==='closed'?el('span',{style:{marginLeft:'8px',fontFamily:'var(--font-body)',fontSize:'.62rem',fontWeight:'700',letterSpacing:'.06em',textTransform:'uppercase',color:'var(--gold-dim)',background:'rgba(138,114,52,.12)',padding:'2px 7px',borderRadius:'10px',verticalAlign:'middle'}},'Closed'):null]),
          el('p',{style:{fontSize:'.82rem',color:'var(--text-light)'}},b.description||'No description')
        ]),
        el('div',{style:{textAlign:'right'}},[
          el('div',{style:{fontFamily:'var(--font-display)',fontSize:'1.4rem',color:'var(--navy)'}},''+(b.receipt_count||0)),
          el('div',{style:{fontSize:'.7rem',color:'var(--text-light)',textTransform:'uppercase',letterSpacing:'.06em'}},'Receipts')
        ])
      ]),
      el('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'16px',paddingTop:'12px',borderTop:'1px solid rgba(10,22,40,.04)'}},[
        el('span',{style:{fontSize:'.82rem',color:'var(--gold-dim)'}},b.currency+' '+fmt(b.total_amount||0)),
        el('div',{style:{display:'flex',gap:'6px'}},[
          b.permission?null:el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--gold-dim)',borderColor:'var(--cream-dark)',fontSize:'.75rem',padding:'4px 10px'},onclick:function(e){e.stopPropagation();showShareModal(b.id)}},'Share'),
          el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)',fontSize:'.75rem',padding:'4px 10px'},onclick:function(e){e.stopPropagation();editBook(b)}},'Edit'),
          b.permission?null:el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)',fontSize:'.75rem',padding:'4px 10px'},onclick:function(e){e.stopPropagation();setBookClosed(b,b.status!=='closed')}},b.status==='closed'?'Reopen':'Close'),
          b.permission?null:el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.75rem',padding:'4px 10px'},onclick:function(e){e.stopPropagation();deleteBook(b)}},'Delete')
        ])
      ])
    ]);
    g.appendChild(card);
  });
}
$('newBookBtn').addEventListener('click',function(){showBookModal()});

function showBookModal(book){
  var isEdit=!!book;
  $('modalTitle').textContent=isEdit?'Edit Book':'New Book';
  $('modalBody').replaceChildren(
    formGroup('Name','text','bookName',book?book.name:'','Book name'),
    formGroup('Description','text','bookDesc',book?book.description||'':'','Optional description'),
    formGroupSelect('Currency','bookCur',['USD','EUR','GBP','CAD','AUD','JPY'],book?book.currency:'USD')
  );
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    el('button',{className:'btn btn-gold',onclick:async function(){
      var name=$('bookName').value.trim();if(!name){toast('Name is required','error');return}
      try{
        if(isEdit)await api('/api/books/'+book.id,{method:'PUT',body:{name:name,description:$('bookDesc').value||null,currency:$('bookCur').value}});
        else await api('/api/books',{method:'POST',body:{name:name,description:$('bookDesc').value||null,currency:$('bookCur').value}});
        closeModal();toast(isEdit?'Book updated':'Book created');loadBooks();fetchBooks();
        if(!isEdit&&onbResumeAfterBook){onbResumeAfterBook=false;document.getElementById('onbOverlay').classList.add('show');renderOnb();}
      }catch(e){toast(e.message,'error')}
    }},isEdit?'Save':'Create')
  );
  openModal();
}
function editBook(b){showBookModal(b)}
async function setBookClosed(b,close){
  if(close&&!confirm('Close "'+b.name+'"? It becomes read-only — no new receipts or edits until you reopen it.'))return;
  try{await api('/api/books/'+b.id+'/status',{method:'POST',body:{status:close?'closed':'open'}});toast(close?'Book closed':'Book reopened');loadBooks();fetchBooks()}catch(e){toast(e.message,'error')}
}
async function deleteBook(b){
  if(!confirm('Delete "'+b.name+'"? This will delete all receipts in this book.'))return;
  try{await api('/api/books/'+b.id,{method:'DELETE'});toast('Book deleted');loadBooks();fetchBooks()}catch(e){toast(e.message,'error')}
}
function showBookDetail(b){
  curBook=b;$('receiptBookFilter').value=b.id;navigate('expenses');
}

// SHARING
async function showShareModal(bookId){
  $('modalTitle').textContent='Share Book';
  $('modalBody').replaceChildren(el('div',{className:'loading'},'Loading...'));
  openModal();
  try{
    var book=await api('/api/books/'+bookId);
    $('modalBody').replaceChildren(
      formGroup('Email','email','shareEmail','','Email address (registered or not)'),
      formGroupSelect('Role','sharePerm',['reader','member','admin'],'reader'),
      el('p',{style:{fontSize:'.75rem',color:'var(--text-light)',margin:'-8px 0 12px',lineHeight:'1.4'}},'Reader: view only. Member: can upload receipts. Admin: full control.'),
      el('div',{id:'shareList',style:{marginTop:'16px'}})
    );
    renderShares(book.shares||[],book.invitations||[],bookId);
    $('modalFooter').replaceChildren(
      el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Close'),
      el('button',{className:'btn btn-gold',onclick:async function(){
        var em=$('shareEmail').value.trim();if(!em){toast('Email required','error');return}
        try{await api('/api/books/'+bookId+'/shares',{method:'POST',body:{email:em,role:$('sharePerm').value}});toast('Shared successfully');var bk=await api('/api/books/'+bookId);renderShares(bk.shares||[],bk.invitations||[],bookId);$('shareEmail').value=''}catch(e){toast(e.message,'error')}
      }},'Share')
    );
  }catch(e){$('modalBody').replaceChildren(el('p',{className:'loading'},e.message))}
}
function renderShares(shares,invitations,bookId){
  var c=document.getElementById('shareList');if(!c)return;c.replaceChildren();
  if(!shares.length&&!invitations.length){c.appendChild(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',padding:'8px 0'}},'Not shared with anyone yet.'));return}
  shares.forEach(function(s){
    c.appendChild(el('div',{className:'share-item'},[
      el('div',{className:'share-info'},[el('span',{className:'share-name'},s.user_name||'User'),el('span',{className:'share-email'},s.email||'')]),
      el('div',{style:{display:'flex',gap:'8px',alignItems:'center'}},[
        el('span',{className:'share-perm'},s.permission),
        el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.7rem',padding:'2px 8px'},onclick:async function(){
          try{await api('/api/books/'+bookId+'/shares/'+s.id,{method:'DELETE'});toast('Share revoked');var bk=await api('/api/books/'+bookId);renderShares(bk.shares||[],bk.invitations||[],bookId)}catch(e){toast(e.message,'error')}
        }},'Revoke')
      ])
    ]));
  });
  if(invitations.length){
    c.appendChild(el('div',{style:{fontSize:'.78rem',fontWeight:'600',color:'var(--gold-dim)',textTransform:'uppercase',letterSpacing:'.08em',padding:'12px 0 4px',borderTop:shares.length?'1px solid rgba(10,22,40,.06)':'none'}},'Pending Invitations'));
    invitations.forEach(function(inv){
      c.appendChild(el('div',{className:'share-item'},[
        el('div',{className:'share-info'},[el('span',{className:'share-name',style:{fontStyle:'italic'}},inv.email),el('span',{className:'share-email'},'Pending registration')]),
        el('div',{style:{display:'flex',gap:'8px',alignItems:'center'}},[
          el('span',{className:'share-perm'},inv.role),
          el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.7rem',padding:'2px 8px'},onclick:async function(){
            try{await api('/api/books/'+bookId+'/invitations/'+inv.id,{method:'DELETE'});toast('Invitation revoked');var bk=await api('/api/books/'+bookId);renderShares(bk.shares||[],bk.invitations||[],bookId)}catch(e){toast(e.message,'error')}
          }},'Cancel')
        ])
      ]));
    });
  }
}

// RECEIPTS
var receiptFilters={};
var allBooksMode=false;
function setBookColumn(show){var h=document.querySelector('#pg-expenses .bookcol');if(h)h.style.display=show?'':'none';}
async function loadReceipts(page){
  curPage=page||1;
  var bookId=$('receiptBookFilter').value;
  allBooksMode=(!bookId && books.length>0);
  if(!bookId && !books.length){setBookColumn(false);$('receiptsTable').replaceChildren(el('tr',null,[el('td',{colspan:'7',className:'empty'},'Create a book to get started.')]));return}
  try{localStorage.setItem('wl_book',bookId);}catch(e){}
  setBookColumn(allBooksMode);
  var pageSize=parseInt(localStorage.getItem('wl_pageSize'))||10;
  var params='?page='+curPage+'&limit='+pageSize;
  var search=$('searchFilter').value.trim();if(search)params+='&search='+encodeURIComponent(search);
  var cat=$('categoryFilter').value;if(cat)params+='&category='+encodeURIComponent(cat);
  var st=$('statusFilter').value;if(st)params+='&status='+st;
  var df=$('dateFromFilter').value;if(df)params+='&date_from='+df;
  var dt=$('dateToFilter').value;if(dt)params+='&date_to='+dt;
  var book=books.find(function(b){return b.id===bookId});
  $('receiptsSubtitle').textContent=allBooksMode?'All books · receipts':(book?book.name+' receipts':'receipts');
  resetSelectionForBook(bookId||'all');
  try{
    var url=allBooksMode?('/api/receipts'+params):('/api/books/'+encodeURIComponent(bookId)+'/receipts'+params);
    var d=await api(url);
    receipts=d.receipts||d||[];var pg=d.pagination;totalPages=pg?pg.pages:1;
    renderReceipts(receipts);renderPagination(pg);
  }catch(e){$('receiptsTable').replaceChildren(el('tr',null,[el('td',{colspan:allBooksMode?'8':'7',className:'loading'},e.message)]))}
}
['receiptBookFilter','categoryFilter','statusFilter'].forEach(function(id){$(id).addEventListener('change',function(){loadReceipts(1)})});
$('searchFilter').addEventListener('input',debounce(function(){loadReceipts(1)},400));
$('dateFromFilter').addEventListener('change',function(){loadReceipts(1)});
$('dateToFilter').addEventListener('change',function(){loadReceipts(1)});

var selectedReceiptIds={};
var selectionBookId=null;
function resetSelectionForBook(bookId){
  if(selectionBookId!==bookId){selectionBookId=bookId;selectedReceiptIds={};updateSelectionBar()}
}
function updateSelectionBar(){
  var n=Object.keys(selectedReceiptIds).length;
  $('selectionBar').style.display=n?'flex':'none';
  $('selCount').textContent=n+' selected';
}
function toggleReceiptSelection(id,checked){
  if(checked)selectedReceiptIds[id]=true;else delete selectedReceiptIds[id];
  updateSelectionBar();
}
function renderReceipts(recs){
  var t=$('receiptsTable');t.replaceChildren();
  if(!recs.length){t.appendChild(el('tr',null,[el('td',{colspan:allBooksMode?'8':'7',style:{textAlign:'center',padding:'40px',color:'var(--text-light)'}},'No receipts found')]));return}
  recs.forEach(function(r){
    var cbCell;
    if(r.status==='completed'){
      var cb=el('input',{type:'checkbox'});
      cb.checked=!!selectedReceiptIds[r.id];
      cb.addEventListener('click',function(ev){ev.stopPropagation();toggleReceiptSelection(r.id,this.checked)});
      cbCell=el('td',null,[cb]);
      cbCell.addEventListener('click',function(ev){ev.stopPropagation()});
    }else{
      cbCell=el('td',null,'');
    }
    var cells=[cbCell];
    if(allBooksMode)cells.push(el('td',{style:{color:'var(--text-light)',fontSize:'.85rem'}},r.book_name||'--'));
    var isDup=r.notes&&r.notes.indexOf('Possible duplicate')===0;
    var merchantCell=[document.createTextNode(r.merchant||'--')];
    if(isDup)merchantCell.push(el('span',{title:r.notes,style:{marginLeft:'8px',display:'inline-block',padding:'1px 7px',borderRadius:'10px',background:'#fef3cd',color:'#856404',fontSize:'.68rem',fontWeight:'600',border:'1px solid rgba(133,100,4,.25)',verticalAlign:'middle',whiteSpace:'nowrap'}},'duplicate'));
    cells.push(
      el('td',null,fmtDate(r.date)),
      el('td',{style:{fontWeight:'500'}},merchantCell),
      el('td',null,r.category||'--'),
      el('td',{style:{fontWeight:'600',fontVariantNumeric:'tabular-nums'}},fmt(r.amount)),
      el('td',null,[sourceBadge(r.source)]),
      el('td',null,[statusBadge(r.status)])
    );
    t.appendChild(el('tr',{onclick:function(){openReceipt(r.book_id,r.id)}},cells));
  });
}
function renderPagination(pg){
  var c=$('receiptsPagination');c.replaceChildren();if(!pg)return;
  c.appendChild(el('span',{className:'pagination-info'},'Page '+pg.page+' of '+pg.pages+' ('+pg.total+' total)'));
  var curSize=parseInt(localStorage.getItem('wl_pageSize'))||10;
  var sel=el('select',{className:'filter-select',style:{fontSize:'.8rem',padding:'4px 8px',minWidth:'auto'}});
  [10,25,50,100].forEach(function(n){var o=el('option',{value:n},n+' per page');if(n===curSize)o.selected=true;sel.appendChild(o)});
  sel.addEventListener('change',function(){localStorage.setItem('wl_pageSize',this.value);loadReceipts(1)});
  c.appendChild(el('div',{className:'pagination-btns'},[
    sel,
    el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page<=1,onclick:function(){loadReceipts(pg.page-1)}},'Previous'),
    el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page>=pg.pages,onclick:function(){loadReceipts(pg.page+1)}},'Next')
  ]));
}
$('clearSelBtn').addEventListener('click',function(){selectedReceiptIds={};updateSelectionBar();renderReceipts(receipts)});
$('addSelToReportBtn').addEventListener('click',function(){
  var ids=Object.keys(selectedReceiptIds);
  if(!ids.length)return;
  showReportPickerModal(ids);
});
async function showReportPickerModal(receiptIds){
  var bookId=$('receiptBookFilter').value||getBookId();
  if(!bookId){toast('No book selected','error');return}
  $('modalTitle').textContent='Add '+receiptIds.length+' to Report';
  var body=$('modalBody');body.replaceChildren(el('div',{className:'loading'},'Loading reports...'));
  $('modalFooter').replaceChildren(el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'));
  openModal();
  async function addTo(reportId){
    try{
      await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(reportId)+'/items',{method:'POST',body:{receipt_ids:receiptIds}});
      toast('Added '+receiptIds.length+' receipt'+(receiptIds.length===1?'':'s')+' to report');
      selectedReceiptIds={};updateSelectionBar();renderReceipts(receipts);closeModal();
    }catch(e){toast(e.message,'error')}
  }
  try{
    var rs=await api('/api/books/'+encodeURIComponent(bookId)+'/reports');
    var drafts=rs.filter(function(r){return r.status==='draft'});
    body.replaceChildren();
    if(drafts.length){
      body.appendChild(el('div',{style:{fontSize:'.78rem',fontWeight:'600',color:'var(--text-light)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:'6px'}},'Draft Reports'));
      drafts.forEach(function(r){
        var addBtnEl=el('button',{className:'btn btn-sm btn-gold',ariaLabel:'Add to '+r.title,onclick:function(ev){ev.stopPropagation();addTo(r.id)}},'Add');
        var row=el('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',border:'1px solid var(--cream-dark)',borderRadius:'8px',marginBottom:'8px',cursor:'pointer'}},[
          el('div',null,[el('div',{style:{fontWeight:'500'}},r.title),el('div',{style:{fontSize:'.75rem',color:'var(--text-light)'}},(r.item_count||0)+' receipt'+((r.item_count||0)===1?'':'s'))]),
          addBtnEl
        ]);
        row.addEventListener('click',function(){addTo(r.id)});
        body.appendChild(row);
      });
      body.appendChild(el('div',{style:{margin:'14px 0 6px',fontSize:'.78rem',fontWeight:'600',color:'var(--text-light)',textTransform:'uppercase',letterSpacing:'.04em'}},'Or create new'));
    }else{
      body.appendChild(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',marginBottom:'10px'}},'No draft reports yet — create one:'));
    }
    body.appendChild(formGroup('New report title','text','pickerReportTitle','','Denver trip - March'));
    $('modalFooter').replaceChildren(
      el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
      el('button',{className:'btn btn-gold',onclick:async function(){
        var t=$('pickerReportTitle').value.trim();if(!t){toast('Enter a title','error');return}
        try{
          var created=await api('/api/books/'+encodeURIComponent(bookId)+'/reports',{method:'POST',body:{title:t}});
          await addTo(created.id);
        }catch(e){toast(e.message,'error')}
      }},'Create & Add')
    );
  }catch(e){body.replaceChildren(el('div',{className:'empty'},e.message))}
}
function statusBadge(s){return el('span',{className:'status-badge status-'+(s||'pending')},(s||'pending'))}
function sourceBadge(s){return el('span',{className:'source-badge'},(s||'manual'))}

// RECEIPT DETAIL
async function openReceipt(bookId,receiptId){
  var panel=$('detailPanel');panel.classList.add('open');
  $('detailContent').replaceChildren(el('div',{className:'loading'},'Loading...'));
  $('detailTitle').textContent='Receipt';
  // Restore receipt buttons (hidden by subscription detail)
  $('viewReceiptBtn').style.display='';
  $('editReceiptBtn').style.display='';
  $('makeRecurringBtn').style.display='';
  $('deleteReceiptBtn').style.display='';
  try{
    selReceipt=await api('/api/books/'+encodeURIComponent(bookId)+'/receipts/'+encodeURIComponent(receiptId));
    selReceipt._bookId=bookId;
    $('detailTitle').textContent=selReceipt.merchant||'Receipt';
    renderReceiptDetail(selReceipt);
  }catch(e){$('detailContent').replaceChildren(el('p',{className:'loading'},e.message))}
}
function openEmailHtml(bookId,receiptId){
  fetch('/api/books/'+encodeURIComponent(bookId)+'/receipts/'+encodeURIComponent(receiptId)+'/image',{headers:{'Authorization':'Bearer '+T}})
  .then(function(res){if(!res.ok)throw new Error();return res.blob()})
  .then(function(blob){window.open(URL.createObjectURL(blob),'_blank')})
  .catch(function(){toast('Could not open email','error')});
}
function loadAttachment(viewer,bookId,receiptId,index,ctHint){
  viewer.replaceChildren(el('div',{className:'loading'},'Loading...'));
  var url=index>=0?'/api/books/'+encodeURIComponent(bookId)+'/receipts/'+encodeURIComponent(receiptId)+'/attachments/'+index:'/api/books/'+encodeURIComponent(bookId)+'/receipts/'+encodeURIComponent(receiptId)+'/image';
  fetch(url,{headers:{'Authorization':'Bearer '+T}})
  .then(function(res){if(!res.ok)throw new Error();var ct=res.headers.get('content-type')||ctHint||'';return res.blob().then(function(blob){return{blob:blob,ct:ct}})})
  .then(function(d){
    viewer.replaceChildren();
    var blobUrl=URL.createObjectURL(d.blob);
    if(d.ct.indexOf('application/pdf')!==-1){
      var iframe=el('iframe',{style:{width:'100%',minHeight:'500px',border:'1px solid var(--cream-dark)',borderRadius:'8px'}});
      iframe.src=blobUrl;viewer.appendChild(iframe);
      viewer.appendChild(el('button',{className:'btn btn-sm btn-outline',style:{marginTop:'8px',color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:function(){window.open(blobUrl,'_blank')}},'Open PDF'));
    } else if(d.ct.indexOf('text/html')!==-1){
      var iframe=el('iframe',{style:{width:'100%',minHeight:'400px',border:'1px solid var(--cream-dark)',borderRadius:'8px',background:'#fff'},sandbox:''});
      iframe.srcdoc=d.blob.text?'':undefined;d.blob.text().then(function(html){iframe.srcdoc=html});viewer.appendChild(iframe);
      viewer.appendChild(el('button',{className:'btn btn-sm btn-outline',style:{marginTop:'8px',color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:function(){window.open(blobUrl,'_blank')}},'Open Full View'));
    } else {
      var img=el('img',{style:{maxWidth:'100%',borderRadius:'8px',boxShadow:'0 4px 16px rgba(0,0,0,.1)',cursor:'pointer'},title:'Click to view full size'});
      img.src=blobUrl;img.addEventListener('click',function(){window.open(blobUrl,'_blank')});viewer.appendChild(img);
    }
  }).catch(function(){viewer.replaceChildren(el('p',{style:{color:'var(--text-light)',fontSize:'.85rem'}},'Could not load attachment.'))});
}
function renderReceiptDetail(r){
  var c=$('detailContent');c.replaceChildren();
  if(r.image_key){
    var atts=[];try{if(r.attachments)atts=JSON.parse(r.attachments)}catch(e){}
    if(atts.length>1){
      // Multiple attachments — show tabs, default to PDF if available
      var tabs=el('div',{style:{display:'flex',gap:'6px',marginBottom:'12px',flexWrap:'wrap'}});
      var viewer=el('div',{className:'img-viewer'});
      var defaultIdx=0;
      // Default to a real document (PDF first, then image) rather than the
      // email-HTML wrapper at index 0, which previews as a near-blank frame.
      for(var di=0;di<atts.length;di++){if(atts[di].content_type==='application/pdf'){defaultIdx=di;break}}
      if(defaultIdx===0){for(var dk=0;dk<atts.length;dk++){if((atts[dk].content_type||'').indexOf('image/')===0){defaultIdx=dk;break}}}
      atts.forEach(function(att,i){
        var label=att.filename||('Attachment '+(i+1));
        if(att.content_type==='text/html')label='Email';
        tabs.appendChild(el('button',{className:'btn btn-sm '+(i===defaultIdx?'btn-navy':'btn-outline'),style:{fontSize:'.75rem',padding:'4px 10px',color:i===defaultIdx?'':'var(--navy)',borderColor:'var(--cream-dark)'},onclick:function(){
          tabs.querySelectorAll('button').forEach(function(b){b.className='btn btn-sm btn-outline';b.style.color='var(--navy)'});
          this.className='btn btn-sm btn-navy';this.style.color='';
          loadAttachment(viewer,r._bookId,r.id,i,att.content_type);
        }},label));
      });
      c.appendChild(tabs);c.appendChild(viewer);
      loadAttachment(viewer,r._bookId,r.id,defaultIdx,atts[defaultIdx].content_type);
    } else if(atts.length===1&&atts[0].content_type==='text/html'){
      // Email receipt with no image/PDF attached — the only document is the
      // email HTML, which previews as a near-blank frame. Show an honest card
      // with a button to open the full email instead of a confusing blank box.
      c.appendChild(el('div',{className:'img-viewer',style:{textAlign:'center',padding:'28px 20px',color:'var(--text-light)'}},[
        el('div',{style:{fontSize:'1.7rem',marginBottom:'6px'}},'✉️'),
        el('div',{style:{fontSize:'.85rem',marginBottom:'14px'}},'Email receipt — no image or PDF was attached.'),
        el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:function(){openEmailHtml(r._bookId,r.id)}},'Open Full Email')
      ]));
    } else {
      // Single image/PDF attachment (or a non-email receipt) — show directly.
      var viewer=el('div',{className:'img-viewer'});
      loadAttachment(viewer,r._bookId,r.id,-1,null);
      c.appendChild(viewer);
    }
  }
  // Duplicate warning
  if(r.notes&&r.notes.indexOf('Possible duplicate')===0){
    c.appendChild(el('div',{style:{background:'#fef3cd',color:'#856404',padding:'10px 14px',borderRadius:'var(--radius)',fontSize:'.85rem',marginBottom:'16px',border:'1px solid rgba(133,100,4,.2)'}},r.notes));
  }
  c.appendChild(detailSection('Details',[
    drow('Merchant',r.merchant),drow('Amount',fmt(r.amount)),drow('Date',fmtDate(r.date)),
    drow('Category',r.category),drow('Subcategory',r.subcategory),drow('Payment Method',r.payment_method),
    drow('Tax',r.tax_amount!=null?fmt(r.tax_amount):null),drow('Tip',r.tip_amount!=null?fmt(r.tip_amount):null),
    drow('Receipt #',r.receipt_number),drow('Invoice #',r.invoice_number),
    drow('Description',r.description),drow('Notes',r.notes&&r.notes.indexOf('Possible duplicate')!==0?r.notes:null)
  ]));
  if(r.line_items&&r.line_items.length){
    var items=r.line_items.map(function(li){
      return el('div',{className:'line-item-row'},[
        el('span',{className:'line-item-desc'},li.description),
        el('span',{className:'line-item-qty'},'x'+li.quantity),
        el('span',{className:'line-item-total'},fmt(li.total))
      ]);
    });
    c.appendChild(detailSection('Line Items',items));
  }
  c.appendChild(detailSection('Tax Deduction',[
    drow('Deductible',r.tax_deductible?'Yes':'No'),
    drow('IRS Category',r.tax_deductible?r.tax_category:null)
  ]));
  var infoRows=[drow('Source',r.source),drow('Status',r.status),drow('AI Confidence',r.ai_confidence!=null?Math.round(r.ai_confidence*100)+'%':null),drow('Created',r.created_at)];
  c.appendChild(detailSection('Info',infoRows));
  if(r.status==='failed'){
    c.appendChild(el('button',{className:'btn btn-gold',style:{width:'100%',marginTop:'8px'},onclick:async function(){
      try{await api('/api/books/'+r._bookId+'/receipts/'+r.id+'/retry',{method:'POST'});toast('Receipt queued for reprocessing');openReceipt(r._bookId,r.id)}catch(e){toast(e.message,'error')}
    }},'Retry Analysis'));
  }
}
function detailSection(title,rows){
  var filtered=rows.filter(function(r){return r});
  return el('div',{className:'detail-section'},[el('h4',null,title)].concat(filtered));
}
function drow(label,value){
  if(value==null||value==='')return null;
  return el('div',{className:'detail-row'},[el('span',{className:'dl'},label),el('span',{className:'dv'},String(value))]);
}
$('closeDetail').addEventListener('click',closeDetailPanel);
function closeDetailPanel(){$('detailPanel').classList.remove('open');selReceipt=null}
// Click outside detail panel to close
document.addEventListener('click',function(e){
  var panel=$('detailPanel');
  if(panel.classList.contains('open')&&!panel.contains(e.target)&&!e.target.closest('table tr,table td')){
    closeDetailPanel();
  }
});

$('viewReceiptBtn').addEventListener('click',function(){if(selReceipt)viewReceiptPrint(selReceipt)});
$('editReceiptBtn').addEventListener('click',function(){if(selReceipt)showReceiptModal(selReceipt)});
$('deleteReceiptBtn').addEventListener('click',async function(){
  if(!selReceipt||!confirm('Delete this receipt?'))return;
  try{await api('/api/books/'+selReceipt._bookId+'/receipts/'+selReceipt.id,{method:'DELETE'});toast('Receipt deleted');closeDetailPanel();loadReceipts(curPage)}catch(e){toast(e.message,'error')}
});
$('makeRecurringBtn').addEventListener('click',function(){
  if(!selReceipt)return;
  var r=selReceipt;
  $('modalTitle').textContent='Make Recurring Expense';
  $('modalBody').replaceChildren(
    formGroup('Name','text','recName',r.merchant||'','Expense name'),
    formGroup('Amount ($)','number','recAmt',r.amount!=null?String(r.amount):'','0.00'),
    formGroupSelect('Frequency','recFreq',['monthly','weekly','biweekly','quarterly','yearly'],'monthly'),
    formGroupSelect('Category','recCat',[''].concat(CATS),r.category||''),
    formGroup('Next Due Date','date','recDue','',''),
    formGroup('Notes','text','recNotes','',r.description||'')
  );
  $('modalFooter').replaceChildren(el('button',{className:'btn btn-primary',onclick:async function(){
    var name=$('recName').value.trim();var amt=parseFloat($('recAmt').value);
    if(!name){toast('Name is required','error');return}
    if(isNaN(amt)||amt<=0){toast('Enter a valid amount','error');return}
    var freq=$('recFreq').value;var cat=$('recCat').value;var due=$('recDue').value;var notes=$('recNotes').value;
    try{
      await api('/api/books/'+encodeURIComponent(r._bookId)+'/recurring-expenses',{method:'POST',body:{name:name,amount:amt,frequency:freq,category:cat||null,next_due_date:due||null,notes:notes||null}});
      toast('Recurring expense created','success');closeModal();
    }catch(e){toast(e.message,'error')}
  }},'Create Recurring'));
  openModal();
});

// SUBSCRIPTION DETAIL
function openSubscriptionDetail(sub){
  var panel=$('detailPanel');panel.classList.add('open');
  $('detailTitle').textContent=sub.product_name||sub.product_id||'Subscription';
  // Hide receipt-specific buttons
  $('viewReceiptBtn').style.display='none';
  $('editReceiptBtn').style.display='none';
  $('makeRecurringBtn').style.display='none';
  $('deleteReceiptBtn').style.display='none';
  var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'Apple App Store'};
  var intervalLabel=sub.plan_interval_count>1?sub.plan_interval_count+' '+sub.plan_interval+'s':sub.plan_interval;
  var c=$('detailContent');c.replaceChildren();
  var statusColor=sub.status==='active'?'var(--green)':sub.status==='canceled'?'#e74c3c':'var(--text-light)';
  var rows=[
    drow('Product',sub.product_name||sub.product_id),
    drow('Source',srcNames[sub.source]||sub.source),
    drow('Status',sub.status),
    drow('Plan',intervalLabel),
    drow('Amount',fmt(sub.amount/100)+' '+sub.currency),
    drow('MRR Contribution',fmt(normalizeToMonthly(sub.amount,sub.plan_interval,sub.plan_interval_count)/100)),
    drow('Started',sub.started_at?fmtDate(sub.started_at):null),
    drow('Current Period',sub.current_period_start&&sub.current_period_end?fmtDate(sub.current_period_start)+' — '+fmtDate(sub.current_period_end):null),
    drow('Next Renewal',sub.current_period_end?fmtDate(sub.current_period_end):null),
    drow('Trial Ends',sub.trial_end_at?fmtDate(sub.trial_end_at):null),
    drow('Canceled At',sub.canceled_at?fmtDate(sub.canceled_at):null),
    drow('Cancels On',sub.cancel_at?fmtDate(sub.cancel_at):null),
    drow('Customer ID',sub.customer_id),
  ].filter(Boolean);
  // Replace the Status row with a colored badge
  rows.forEach(function(row){c.appendChild(row)});
  // Insert status with color
  var statusRows=c.querySelectorAll('.detail-row');
  statusRows.forEach(function(r){
    if(r.querySelector('.dl')&&r.querySelector('.dl').textContent==='Status'){
      var dv=r.querySelector('.dv');dv.textContent=sub.status;dv.style.color=statusColor;dv.style.fontWeight='600';dv.style.textTransform='capitalize';
    }
  });
}
function normalizeToMonthly(amount,interval,count){
  switch(interval){
    case 'month':return Math.round(amount/count);
    case 'year':return Math.round(amount/(count*12));
    case 'week':return Math.round(amount*(52/12)/count);
    case 'day':return Math.round(amount*(365/12)/count);
    default:return amount;
  }
}
// VIEW RECEIPT — opens original vendor receipt (email HTML or uploaded image)
async function viewReceiptPrint(r){
  if(!r.image_key){toast('No receipt document available','error');return}
  try{
    var res=await fetch('/api/books/'+encodeURIComponent(r._bookId)+'/receipts/'+encodeURIComponent(r.id)+'/image',{headers:{'Authorization':'Bearer '+T}});
    if(!res.ok)throw new Error('Failed to load receipt');
    var blob=await res.blob();
    var url=URL.createObjectURL(blob);
    window.open(url,'_blank');
    setTimeout(function(){URL.revokeObjectURL(url)},120000);
  }catch(e){toast(e.message,'error')}
}

$('refreshExpenses').addEventListener('click',function(){this.classList.add('spinning');loadReceipts(1).finally(()=>this.classList.remove('spinning'))});
// ADD/EDIT RECEIPT MODAL
$('addReceiptBtn').addEventListener('click',function(){showReceiptModal()});
function showReceiptModal(receipt){
  var isEdit=!!receipt;var bookId=isEdit?receipt._bookId:$('receiptBookFilter').value;
  $('modalTitle').textContent=isEdit?'Edit Receipt':'Add Receipt';
  var bookSelect=el('div',{className:'form-group'},[
    el('label',null,'Book'),
    (function(){
      var s=el('select',{className:'form-select',id:'rcptBook'});
      books.forEach(function(b){var opt=el('option',{value:b.id},b.name);if(isEdit&&b.id===receipt._bookId)opt.selected=true;else if(!isEdit&&b.id===bookId)opt.selected=true;s.appendChild(opt)});
      return s;
    })()
  ]);
  var body=$('modalBody');body.replaceChildren(
    bookSelect,
    formGroup('Merchant','text','rcptMerchant',isEdit?receipt.merchant||'':'','Merchant name'),
    el('div',{className:'form-row'},[
      formGroup('Amount','number','rcptAmount',isEdit&&receipt.amount!=null?receipt.amount:'','0.00'),
      formGroup('Date','date','rcptDate',isEdit?receipt.date||'':'')
    ]),
    el('div',{className:'form-row'},[
      formGroupSelect('Category','rcptCategory',[''].concat(CATS),isEdit?receipt.category||'':''),
      formGroup('Subcategory','text','rcptSubcat',isEdit?receipt.subcategory||'':'','Optional')
    ]),
    formGroup('Payment Method','text','rcptPayment',isEdit?receipt.payment_method||'':'','e.g. Visa 4242, Cash'),
    el('div',{className:'form-row'},[
      formGroup('Tax','number','rcptTax',isEdit&&receipt.tax_amount!=null?receipt.tax_amount:'','0.00'),
      formGroup('Tip','number','rcptTip',isEdit&&receipt.tip_amount!=null?receipt.tip_amount:'','0.00')
    ]),
    formGroup('Notes','text','rcptNotes',isEdit?receipt.notes||'':'','Optional notes'),
    (function(){
      var wrap=el('div',{className:'form-group',style:{marginTop:'8px'}});
      var chk=el('input',{type:'checkbox',id:'rcptDeductible',style:{marginRight:'6px'}});
      if(isEdit&&receipt.tax_deductible)chk.checked=true;
      var label=el('label',{for:'rcptDeductible',style:{display:'flex',alignItems:'center',cursor:'pointer'}},[chk,el('span',null,'Tax Deductible')]);
      wrap.appendChild(label);
      var irsCats=['Advertising','Car & Truck Expenses','Commissions & Fees','Contract Labor','Depreciation','Employee Benefits','Insurance','Interest (Mortgage/Other)','Legal & Professional','Office Expense','Pension & Profit-Sharing','Rent (Vehicles/Equipment/Other)','Repairs & Maintenance','Supplies','Taxes & Licenses','Travel','Meals','Utilities','Wages','Other Expenses'];
      var catSel=formGroupSelect('IRS Category','rcptTaxCat',irsCats,isEdit&&receipt.tax_category?receipt.tax_category:'Other Expenses');
      catSel.id='rcptTaxCatWrap';
      catSel.style.display=chk.checked?'':'none';
      chk.addEventListener('change',function(){catSel.style.display=this.checked?'':'none'});
      wrap.appendChild(catSel);
      return wrap;
    })()
  );
  var footerBtns=[
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    isEdit?el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:function(){showShareModal(receipt._bookId)}},'Share Book'):null,
    el('button',{className:'btn btn-gold',onclick:async function(){
      var newBookId=$('rcptBook').value;
      var data={merchant:$('rcptMerchant').value,amount:parseFloat($('rcptAmount').value)||0,date:$('rcptDate').value,category:$('rcptCategory').value||null,subcategory:$('rcptSubcat').value||null,payment_method:$('rcptPayment').value||null,notes:$('rcptNotes').value||null};
      var tax=parseFloat($('rcptTax').value);if(!isNaN(tax))data.tax_amount=tax;
      var tip=parseFloat($('rcptTip').value);if(!isNaN(tip))data.tip_amount=tip;
      data.tax_deductible=$('rcptDeductible').checked?1:0;
      data.tax_category=$('rcptDeductible').checked?$('rcptTaxCat').value:null;
      if(isEdit&&newBookId!==receipt._bookId)data.book_id=newBookId;
      try{
        if(isEdit){await api('/api/books/'+receipt._bookId+'/receipts/'+receipt.id,{method:'PUT',body:data});toast('Receipt updated');if(newBookId!==receipt._bookId){closeDetailPanel()}else{openReceipt(newBookId,receipt.id)}}
        else{if(!newBookId){toast('Select a book first','error');return}data.source='manual';await api('/api/books/'+newBookId+'/receipts',{method:'POST',body:data});toast('Receipt created')}
        closeModal();loadReceipts(curPage);
      }catch(e){toast(e.message,'error')}
    }},isEdit?'Save':'Create')
  ].filter(Boolean);
  $('modalFooter').replaceChildren.apply($('modalFooter'),footerBtns);
  openModal();
}

// UPLOAD
$('uploadReceiptBtn').addEventListener('click',function(){$('uploadOverlay').classList.add('show');$('uploadError').style.display='none';$('uploadPreview').replaceChildren();$('uploadFile').value=''});
$('uploadClose').addEventListener('click',function(){$('uploadOverlay').classList.remove('show')});
$('uploadFile').addEventListener('change',function(){
  var files=this.files;$('uploadPreview').replaceChildren();
  if(!files||!files.length)return;
  Array.from(files).forEach(function(file){
    if(file.type==='application/pdf'){
      $('uploadPreview').appendChild(el('div',{style:{display:'inline-flex',alignItems:'center',gap:'8px',padding:'8px 12px',background:'var(--cream)',borderRadius:'8px',margin:'4px',fontSize:'.85rem'}},[
        el('span',{style:{fontSize:'1.2rem'}},'\\uD83D\\uDCC4'),el('span',null,file.name)
      ]));
    } else {
      var img=el('img',{style:{maxWidth:'120px',maxHeight:'120px',borderRadius:'8px',margin:'4px',objectFit:'cover'}});
      var reader=new FileReader();reader.onload=function(e){img.src=e.target.result};reader.readAsDataURL(file);
      $('uploadPreview').appendChild(img);
    }
  });
});
$('uploadSubmit').addEventListener('click',async function(){
  var files=$('uploadFile').files;var bookId=$('uploadBook').value;
  if(!files||!files.length){toast('Select files to upload','error');return}
  if(!bookId){toast('Select a book','error');return}
  this.disabled=true;this.textContent='Uploading '+files.length+' file'+(files.length>1?'s':'')+'...';
  try{
    var formData=new FormData();
    Array.from(files).forEach(function(f){formData.append('files',f)});
    var r=await fetch('/api/books/'+encodeURIComponent(bookId)+'/receipts/upload',{method:'POST',headers:{'Authorization':'Bearer '+T},body:formData});
    var d=await r.json();if(!r.ok)throw new Error(d.error||'Upload failed');
    toast(files.length===1?'Receipt uploaded! Processing...':files.length+' receipts uploaded! Processing...');
    $('uploadOverlay').classList.remove('show');loadReceipts(curPage);
  }catch(e){$('uploadError').textContent=e.message;$('uploadError').style.display='block'}
  finally{this.disabled=false;this.textContent='Upload & Analyze'}
});

// INCOME
var incPage=1;
async function loadIncome(page){
  incPage=page||1;
  if(!integrations.length){try{integrations=await api('/api/integrations')}catch(e){}}
  try{
    var sum=await api('/api/income/summary');
    var o=sum.overview||{};
    // LED-39: tiles show gross (customer paid), fee (platform commission),
    // and net (developer keeps). The label "after fees" makes it explicit
    // that Net Revenue is post-commission.
    var grossCents=o.gross_cents||o.total_cents||0;
    var feeCents=o.fee_cents||0;
    var netCents=o.net_cents||(grossCents-feeCents);
    var feePct=grossCents>0?Math.round((feeCents/grossCents)*100):0;
    $('incomeStats').replaceChildren(
      statCard('Customer Paid',fmt(grossCents/100),(o.count||0)+' transactions'),
      statCard('Platform Fees',fmt(feeCents/100),feePct?feePct+'% effective':'platform commission'),
      statCard('You Earned',fmt(netCents/100),'after fees')
    );
    // Monthly chart
    var mc=$('incomeMonthlyChart');mc.replaceChildren();
    var months=(sum.by_month||[]).filter(function(m){return m&&m.month}).slice().sort(function(a,b){return (a.month||'').localeCompare(b.month||'')}).slice(-12);
    if(months.length){
      var max=Math.max.apply(null,months.map(function(m){return m.total_cents}))||1;
      months.forEach(function(m){
        var h=Math.max(2,m.total_cents/max*140);
        mc.appendChild(el('div',{className:'bar-col'},[el('div',{className:'bar-value'},'$'+Math.round(m.total_cents/100)),el('div',{className:'bar',style:{height:h+'px',background:'var(--green)'}}),el('div',{className:'bar-label'},m.month.slice(5))]));
      });
    } else {mc.appendChild(el('div',{className:'empty',style:{width:'100%'}},integrations.length?'No revenue data yet.':'No revenue data yet. Connect an integration in Settings.'))}
    // By source
    var sl=$('incomeSourceList');sl.replaceChildren();
    var srcColors={'stripe':'#635bff','google_play':'#34a853','apple_app_store':'#007aff'};
    var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'App Store'};
    (sum.by_source||[]).forEach(function(s){
      sl.appendChild(el('li',{className:'cat-item'},[
        el('span',{className:'cat-dot',style:{background:srcColors[s.source]||'var(--gold)'}}),
        el('span',{className:'cat-name'},srcNames[s.source]||s.source),
        el('span',{className:'cat-amount'},fmt(s.total_cents/100)),
        el('span',{className:'cat-count'},s.count+'x')
      ]));
    });
    if(!(sum.by_source||[]).length)sl.appendChild(el('li',{className:'empty',style:{padding:'20px'}},'No sources yet'));
    // Transactions
    var params='?page='+incPage+'&limit=50';
    var d=await api('/api/income'+params);
    renderIncomeTable(d.transactions||[]);
    renderIncomePagination(d.pagination);
  }catch(e){$('incomeStats').replaceChildren(el('p',{className:'loading'},e.message))}
}
function renderIncomeTable(txns){
  var t=$('incomeTable');t.replaceChildren();
  if(!txns.length){t.appendChild(el('tr',null,[el('td',{colspan:'6',style:{textAlign:'center',padding:'40px',color:'var(--text-light)'}},'No income transactions')]));return}
  var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'App Store'};
  txns.forEach(function(tx){
    // LED-39: render three money columns — gross (customer paid), fee
    // (platform commission), net (developer earned). Primary number in USD;
    // local currency as a hint beneath. Effective commission rate shown on
    // hover via title attribute (decided: hover only, no dedicated column).
    var grossLocal=tx.gross_amount!=null?tx.gross_amount:tx.amount;
    var grossCcy=(tx.gross_currency||tx.currency||'USD').toUpperCase();
    var grossUsd=tx.usd_gross_cents!=null?tx.usd_gross_cents:tx.usd_amount_cents;
    var feeUsd=tx.usd_fee_cents;
    var netUsd=grossUsd!=null?(grossUsd-(feeUsd||0)):null;
    var feePct=(grossUsd&&feeUsd!=null&&grossUsd!==0)?Math.round((feeUsd/grossUsd)*100):null;

    var fmtCell=function(usdCents, localCents, ccy, isFee){
      var primary=usdCents!=null?fmt(usdCents/100):(ccy==='USD'?fmt(localCents/100):'--');
      var hint='';
      if(usdCents!=null&&ccy!=='USD'&&localCents!=null){
        hint=ccy+' '+(localCents/100).toFixed(2);
      }
      return el('td',{
        style:{fontWeight:isFee?'400':'600',fontVariantNumeric:'tabular-nums',textAlign:'right',color:isFee?'var(--text-light)':''},
      },[
        el('div',null,primary),
        hint?el('div',{style:{fontSize:'11px',fontWeight:'400',color:'var(--text-light)'}},hint):null
      ].filter(Boolean));
    };

    var feeCell=fmtCell(feeUsd,null,grossCcy,true);
    if(feePct!=null) feeCell.setAttribute('title','Effective commission rate: '+feePct+'%');

    t.appendChild(el('tr',null,[
      el('td',null,fmtDate(tx.transaction_date)),
      el('td',null,[el('span',{className:'source-badge'},srcNames[tx.source]||tx.source)]),
      el('td',null,tx.description||'--'),
      fmtCell(grossUsd, grossLocal, grossCcy, false),
      feeCell,
      fmtCell(netUsd, tx.net_amount, (tx.currency||'USD').toUpperCase(), false),
    ]));
  });
}
function renderIncomePagination(pg){
  var c=$('incomePagination');c.replaceChildren();if(!pg)return;
  c.appendChild(el('span',{className:'pagination-info'},'Page '+pg.page+' of '+pg.pages+' ('+pg.total+' total)'));
  c.appendChild(el('div',{className:'pagination-btns'},[
    el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page<=1,onclick:function(){loadIncome(pg.page-1)}},'Previous'),
    el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page>=pg.pages,onclick:function(){loadIncome(pg.page+1)}},'Next')
  ]));
}

$('refreshIncome').addEventListener('click',function(){this.classList.add('spinning');loadIncome(1).finally(()=>this.classList.remove('spinning'))});

// SUBSCRIPTIONS
var subPage=1;
async function loadSubscriptions(page){
  subPage=page||1;
  var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'App Store'};
  var srcColors={'stripe':'#635bff','google_play':'#34a853','apple_app_store':'#007aff'};
  try{
    var sum=await api('/api/subscriptions/summary');
    $('subStats').replaceChildren(
      statCard('MRR',fmt((sum.mrr_cents||0)/100),'monthly recurring'),
      statCard('ARR',fmt((sum.arr_cents||0)/100),'annual recurring'),
      statCard('Active',''+(sum.active_count||0),'subscriptions'),
      statCard('Churned (30d)',''+(sum.churned_30d||0),'cancellations')
    );
    // By source
    var sl=$('subSourceList');sl.replaceChildren();
    (sum.by_source||[]).forEach(function(s){
      sl.appendChild(el('li',{className:'cat-item'},[
        el('span',{className:'cat-dot',style:{background:srcColors[s.source]||'var(--gold)'}}),
        el('span',{className:'cat-name'},srcNames[s.source]||s.source),
        el('span',{className:'cat-amount'},fmt(s.mrr_cents/100)+'/mo'),
        el('span',{className:'cat-count'},s.count+' active')
      ]));
    });
    if(!(sum.by_source||[]).length)sl.appendChild(el('li',{className:'empty',style:{padding:'20px'}},'No subscriptions yet'));
  }catch(e){$('subStats').replaceChildren(el('p',{className:'loading'},e.message))}
  // Forecast chart
  try{
    var fc=await api('/api/subscriptions/forecast?months=12');
    var mc=$('subForecastChart');mc.replaceChildren();
    var months=fc.periods||[];
    if(months.length){
      var max=Math.max.apply(null,months.map(function(m){return m.expected_revenue_cents}))||1;
      months.forEach(function(m){
        var h=Math.max(2,m.expected_revenue_cents/max*140);
        mc.appendChild(el('div',{className:'bar-col'},[el('div',{className:'bar-value'},'$'+Math.round(m.expected_revenue_cents/100)),el('div',{className:'bar',style:{height:h+'px',background:'var(--gold)'}}),el('div',{className:'bar-label'},m.month.slice(5))]));
      });
    } else {mc.appendChild(el('div',{className:'empty',style:{width:'100%'}},'No forecast data yet.'))}
  }catch(e){}
  // Subscriptions table
  try{
    var d=await api('/api/subscriptions?page='+subPage+'&limit=50');
    var t=$('subTable');t.replaceChildren();
    var subs=d.subscriptions||[];
    if(!subs.length){t.appendChild(el('tr',null,[el('td',{colspan:'6',style:{textAlign:'center',padding:'40px',color:'var(--text-light)'}},'No subscriptions')]));
    } else {
      subs.forEach(function(s){
        var statusCls=s.status==='active'?'color:var(--green)':s.status==='canceled'?'color:#e74c3c':'color:var(--text-light)';
        var intervalLabel=s.plan_interval_count>1?s.plan_interval_count+' '+s.plan_interval+'s':''+s.plan_interval;
        t.appendChild(el('tr',{style:{cursor:'pointer'},onclick:function(e){e.stopPropagation();openSubscriptionDetail(s)}},[
          el('td',{style:{fontWeight:'600'}},s.product_name||s.product_id||'--'),
          el('td',null,[el('span',{className:'source-badge'},srcNames[s.source]||s.source)]),
          el('td',null,intervalLabel),
          el('td',{style:{fontWeight:'600',fontVariantNumeric:'tabular-nums'}},fmt(s.amount/100)),
          el('td',null,[el('span',{style:statusCls},s.status)]),
          el('td',null,s.current_period_end?fmtDate(s.current_period_end):'--')
        ]));
      });
    }
    // Pagination
    var pc=$('subPagination');pc.replaceChildren();
    var pg=d.pagination;
    if(pg){
      pc.appendChild(el('span',{className:'pagination-info'},'Page '+pg.page+' of '+pg.pages+' ('+pg.total+' total)'));
      pc.appendChild(el('div',{className:'pagination-btns'},[
        el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page<=1,onclick:function(){loadSubscriptions(pg.page-1)}},'Previous'),
        el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},disabled:pg.page>=pg.pages,onclick:function(){loadSubscriptions(pg.page+1)}},'Next')
      ]));
    }
  }catch(e){}
}

$('refreshSubs').addEventListener('click',function(){this.classList.add('spinning');loadSubscriptions(1).finally(()=>this.classList.remove('spinning'))});

// INTEGRATIONS
var integrations=[];
async function loadIntegrations(){
  try{integrations=await api('/api/integrations')}catch(e){integrations=[]}
  renderIntegrations();
}
function renderIntegrations(){
  var c=$('integrationsList');if(!c)return;c.replaceChildren();
  var srcNames={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'Apple App Store'};
  var srcColors={'stripe':'#635bff','google_play':'#34a853','apple_app_store':'#007aff'};
  if(!integrations.length){c.appendChild(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',fontStyle:'italic',padding:'4px 0'}},'No integrations connected.'));return}
  integrations.forEach(function(int){
    c.appendChild(el('div',{className:'share-item'},[
      el('div',{className:'share-info'},[
        el('span',{className:'share-name',style:{color:srcColors[int.provider]||'var(--navy)'}},srcNames[int.provider]||int.provider),
        el('span',{className:'share-email'},int.last_sync_at?'Last synced: '+fmtDate(int.last_sync_at):'Never synced'+(int.last_sync_error?' — '+int.last_sync_error:''))
      ]),
      el('div',{style:{display:'flex',gap:'6px',alignItems:'center'}},[
        el('button',{className:'btn btn-sm btn-gold',style:{fontSize:'.7rem',padding:'2px 10px'},onclick:async function(){
          this.textContent='Syncing...';this.disabled=true;
          try{var r=await api('/api/integrations/'+int.id+'/sync',{method:'POST'});toast('Synced '+r.synced+' transactions');loadIntegrations();if(location.hash==='#income')loadIncome()}catch(e){toast(e.message,'error')}
          this.textContent='Sync';this.disabled=false;
        }},'Sync'),
        el('button',{className:'btn btn-sm btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)',fontSize:'.7rem',padding:'2px 10px'},onclick:function(){showIntegrationModal(int.provider)}},'Edit'),
        el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.7rem',padding:'2px 10px'},onclick:async function(){
          if(!confirm('Remove this integration?'))return;
          try{await api('/api/integrations/'+int.id,{method:'DELETE'});toast('Integration removed');loadIntegrations()}catch(e){toast(e.message,'error')}
        }},'Remove')
      ])
    ]));
  });
}
window.showIntegrationModal=function(provider){
  var names={'stripe':'Stripe','google_play':'Google Play','apple_app_store':'Apple App Store'};
  $('modalTitle').textContent='Configure '+names[provider];
  var fields;
  if(provider==='stripe'){
    fields=[formGroup('API Secret Key','password','intStripeKey','','sk_live_...')];
  } else if(provider==='google_play'){
    fields=[
      formGroup('Service Account Email','email','intGpEmail','','name@project.iam.gserviceaccount.com'),
      el('div',{className:'form-group'},[el('label',{for:'intGpKey'},'Private Key (PEM)'),el('textarea',{className:'form-textarea',id:'intGpKey',placeholder:'-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----',style:{minHeight:'100px',fontFamily:'monospace',fontSize:'.75rem'}})]),
      formGroup('Package Name','text','intGpPkg','','com.example.app')
    ];
  } else {
    fields=[
      formGroup('Issuer ID','text','intAppleIssuer','','xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      formGroup('Key ID','text','intAppleKeyId','','XXXXXXXXXX'),
      el('div',{className:'form-group'},[el('label',{for:'intAppleKey'},'Private Key (.p8 contents)'),el('textarea',{className:'form-textarea',id:'intAppleKey',placeholder:'-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----',style:{minHeight:'80px',fontFamily:'monospace',fontSize:'.75rem'}})]),
      formGroup('Vendor Number','text','intAppleVendor','','12345678')
    ];
  }
  $('modalBody').replaceChildren.apply($('modalBody'),fields);
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    el('button',{className:'btn btn-gold',onclick:async function(){
      var creds={};
      if(provider==='stripe'){creds.api_key=$('intStripeKey').value.trim();if(!creds.api_key){toast('API key required','error');return}}
      else if(provider==='google_play'){creds.client_email=$('intGpEmail').value.trim();creds.private_key=$('intGpKey').value.trim();creds.package_name=$('intGpPkg').value.trim();if(!creds.client_email||!creds.private_key||!creds.package_name){toast('All fields required','error');return}}
      else{creds.issuer_id=$('intAppleIssuer').value.trim();creds.key_id=$('intAppleKeyId').value.trim();creds.private_key=$('intAppleKey').value.trim();creds.vendor_number=$('intAppleVendor').value.trim();if(!creds.issuer_id||!creds.key_id||!creds.private_key||!creds.vendor_number){toast('All fields required','error');return}}
      try{await api('/api/integrations',{method:'POST',body:{provider:provider,credentials:creds}});toast('Integration saved');closeModal();loadIntegrations()}catch(e){toast(e.message,'error')}
    }},'Save')
  );
  openModal();
};

// EXPORT
var exportFmts=qa('.export-option');
exportFmts.forEach(function(o){o.addEventListener('click',function(){
  exportFmts.forEach(function(x){x.classList.remove('selected')});this.classList.add('selected');selExportFmt=this.dataset.fmt;
})});
function loadExportPage(){populateBookSelects()}
$('exportBtn').addEventListener('click',function(){
  var bookId=$('exportBookSelect').value;
  if(!bookId&&books.length)bookId=books[0].id;
  if(!bookId){toast('Select a book','error');return}
  var params='?token='+encodeURIComponent(T);
  var df=$('exportDateFrom').value;if(df)params+='&date_from='+df;
  var dt=$('exportDateTo').value;if(dt)params+='&date_to='+dt;
  var cat=$('exportCategory').value;if(cat)params+='&category='+encodeURIComponent(cat);
  window.open('/api/books/'+encodeURIComponent(bookId)+'/export/'+selExportFmt+params,'_blank');
});

var replayBtn=document.getElementById('replayOnb');
if(replayBtn)replayBtn.addEventListener('click',openOnboarding);

// SETTINGS
async function loadSettings(){
  if(!U)try{U=await api('/api/auth/profile')}catch(e){}
  loadIntegrations();
  if(U){$('settEmail').textContent=U.email||'';$('settName').textContent=U.name||'';$('settRole').textContent=(U.role||'').charAt(0).toUpperCase()+(U.role||'').slice(1);$('settSince').textContent=U.created_at?fmtDate(U.created_at):'';
    $('settMfa').textContent=U.mfa_enabled?'Enabled':'Disabled';$('settMfa').style.color=U.mfa_enabled?'var(--green)':'var(--text-light)';
    renderMfaSettings(U.mfa_enabled);
    loadPasskeys();
    renderLinkedEmails(U.linked_emails||[]);
    renderDefaultEmailBook(U.default_book_id);
    // AI Provider
    var prov=U.ai_provider||'anthropic';
    var radios=document.querySelectorAll('input[name="aiProvider"]');
    radios.forEach(function(r){r.checked=r.value===prov;
      r.closest('label').style.borderColor=r.value===prov?'var(--gold)':'var(--cream-dark)';
      r.closest('label').style.background=r.value===prov?'rgba(201,168,76,.05)':'';
      r.addEventListener('change',async function(){
        var val=this.value;
        radios.forEach(function(x){x.closest('label').style.borderColor=x.value===val?'var(--gold)':'var(--cream-dark)';x.closest('label').style.background=x.value===val?'rgba(201,168,76,.05)':''});
        try{await api('/api/auth/preferences',{method:'PUT',body:{ai_provider:val}});U.ai_provider=val;toast('AI provider updated to '+(val==='anthropic'?'Anthropic Claude':val==='openai'?'OpenAI GPT-4o':'WeaveHub AI'))}catch(e){toast(e.message,'error')}
        updateKeyVisibility(val);
        updateWeavehubPanel();
      });
    });
    updateKeyVisibility(prov);
    // API Key status indicators
    if(U.anthropic_api_key){$('anthropicKeyStatus').textContent='Custom key is set';$('anthropicKeyStatus').style.color='var(--green)';$('clearAnthropicKey').style.display=''}
    else{$('anthropicKeyStatus').textContent='Using platform default';$('clearAnthropicKey').style.display='none'}
    if(U.openai_api_key){$('openaiKeyStatus').textContent='Custom key is set';$('openaiKeyStatus').style.color='var(--green)';$('clearOpenaiKey').style.display=''}
    else{$('openaiKeyStatus').textContent='Using platform default';$('clearOpenaiKey').style.display='none'}
    if(U.weavehub_ai_key){$('weavehubKeyStatus').textContent='Key active — stored securely on the server, never displayed';$('weavehubKeyStatus').style.color='var(--green)';$('clearWeavehubKey').style.display=''}
    else{$('weavehubKeyStatus').textContent='No key saved';$('clearWeavehubKey').style.display='none'}
    updateWeavehubPanel();
  }
}
/** Only the selected provider's key field is shown. */
function updateKeyVisibility(prov){
  var map={anthropic:'anthropicKeyGroup',openai:'openaiKeyGroup',weavehub:'weavehubKeyGroup'};
  Object.keys(map).forEach(function(k){
    var g=$(map[k]);if(g)g.style.display=(k===prov)?'':'none';
  });
}
/** Show the usage/buy panel when WeaveHub AI is selected or a key is saved.
    Without a key it offers one-click key creation (server-side, key never
    shown); with a key it shows usage + buy buttons. */
async function updateWeavehubPanel(){
  var panel=$('weavehubAiPanel');if(!panel)return;
  var show=(U&&(U.ai_provider==='weavehub'||U.weavehub_ai_key));
  panel.style.display=show?'':'none';
  if(!show)return;
  var hasKey=!!(U&&U.weavehub_ai_key);
  $('whCreateKey').style.display=hasKey?'none':'';
  $('whBuyRow').style.display=hasKey?'':'none';
  if(!hasKey){
    $('weavehubUsageText').textContent='No key yet — create one to get started. New accounts include 3 trial scans.';
    $('weavehubUsageText').style.color='var(--navy)';
    return;
  }
  try{
    var u=await api('/api/ai/usage');
    var parts=['Key active','Credits: '+u.credit_balance];
    if(u.monthly_quota_scans>0)parts.push('Monthly allowance: '+(u.effective_limit-u.scans_used)+' of '+u.effective_limit+' left');
    parts.push('Total remaining: '+u.remaining+' scan'+(u.remaining===1?'':'s'));
    $('weavehubUsageText').textContent=parts.join(' · ');
    $('weavehubUsageText').style.color=u.remaining>0?'var(--navy)':'var(--red)';
  }catch(e){$('weavehubUsageText').textContent=e.message}
}
async function createWeavehubKey(){
  var btn=$('whCreateKey');btn.disabled=true;
  try{
    var d=await api('/api/ai/create-key',{method:'POST',body:{}});
    U.weavehub_ai_key=true;
    $('weavehubUsageText').textContent='Key active'+(d.trial_scans?' — '+d.trial_scans+' trial scans ready':'')+'. Loading usage…';
    $('weavehubUsageText').style.color='var(--green)';
    $('weavehubKeyStatus').textContent='Key active — stored securely on the server, never displayed';$('weavehubKeyStatus').style.color='var(--green)';$('clearWeavehubKey').style.display='';
    toast('Key created'+(d.trial_scans?' — '+d.trial_scans+' trial scans included':''));
    updateWeavehubPanel();
  }catch(e){toast(e.message,'error')}
  btn.disabled=false;
}
async function weavehubBuy(pack){
  try{
    var d=await api('/api/ai/checkout',{method:'POST',body:{pack:pack}});
    location.href=d.url;
  }catch(e){toast(e.message,'error')}
}
async function renderDefaultEmailBook(current){
  var sel=$('defaultEmailBook');if(!sel)return;
  try{
    var res=await api('/api/books');
    var owned=(res.owned||[]).filter(function(b){return (b.status||'open')==='open'});
    sel.replaceChildren();
    sel.appendChild(el('option',{value:''},'Oldest open book (automatic)'));
    owned.forEach(function(b){
      var o=el('option',{value:b.id},b.name);
      if(b.id===current)o.selected=true;
      sel.appendChild(o);
    });
    sel.onchange=async function(){
      var v=sel.value;
      try{await api('/api/auth/preferences',{method:'PUT',body:{default_book_id:v||null}});U.default_book_id=v||null;toast(v?'Default email book updated':'Email receipts will use your oldest open book')}catch(e){toast(e.message,'error')}
    };
  }catch(e){}
}
function renderLinkedEmails(emails){
  var c=$('linkedEmailsList');if(!c)return;c.replaceChildren();
  if(!emails.length){c.appendChild(el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',padding:'4px 0',fontStyle:'italic'}},'No linked emails yet.'));return}
  emails.forEach(function(em){
    c.appendChild(el('div',{className:'share-item'},[
      el('div',{className:'share-info'},[el('span',{className:'share-name'},em.email),el('span',{className:'share-email'},em.verified?'Verified':'Pending verification')]),
      el('button',{className:'btn btn-sm btn-danger',style:{fontSize:'.7rem',padding:'2px 8px'},onclick:async function(){
        try{await api('/api/auth/emails/'+em.id,{method:'DELETE'});toast('Email removed');U=await api('/api/auth/profile');renderLinkedEmails(U.linked_emails||[])}catch(e){toast(e.message,'error')}
      }},'Remove')
    ]));
  });
}
$('addLinkedEmailBtn').addEventListener('click',async function(){
  var em=$('newLinkedEmail').value.trim();if(!em){toast('Enter an email address','error');return}
  try{await api('/api/auth/emails',{method:'POST',body:{email:em}});toast('Email linked');$('newLinkedEmail').value='';U=await api('/api/auth/profile');renderLinkedEmails(U.linked_emails||[])}catch(e){toast(e.message,'error')}
});
function renderMfaSettings(enabled){
  var c=$('mfaContent');c.replaceChildren();
  if(enabled){
    c.appendChild(el('p',{style:{fontSize:'.88rem',color:'var(--text-light)',marginBottom:'16px'}},'Two-factor authentication is enabled. Your account is secured with an authenticator app.'));
    c.appendChild(el('div',{className:'form-group'},[el('label',{for:'mfaDisablePwd'},'Enter your password'),el('input',{className:'form-input',type:'password',id:'mfaDisablePwd',placeholder:'Your password'})]));
    c.appendChild(el('div',{className:'form-group',style:{marginTop:'12px'}},[el('label',{for:'mfaDisableCode'},'Enter your authenticator code'),el('input',{className:'form-input',type:'text',id:'mfaDisableCode',placeholder:'6-digit code',maxLength:'6',style:{textAlign:'center',letterSpacing:'.15em'}})]));
    c.appendChild(el('button',{className:'btn btn-danger',onclick:async function(){
      var pwd=$('mfaDisablePwd').value,code=$('mfaDisableCode').value;if(!pwd){toast('Password required','error');return}if(!code||code.length<6){toast('Authenticator code required','error');return}
      try{await api('/api/auth/mfa/disable',{method:'POST',body:{password:pwd,code:code}});toast('MFA disabled');U.mfa_enabled=0;loadSettings()}catch(e){toast(e.message,'error')}
    }},'Disable MFA'));
  } else {
    c.appendChild(el('p',{style:{fontSize:'.88rem',color:'var(--text-light)',marginBottom:'16px'}},'Add an extra layer of security. Use an authenticator app like Google Authenticator, Authy, or 1Password.'));
    c.appendChild(el('div',{className:'form-group'},[el('label',{for:'mfaSetupPwd'},'Enter your password to begin setup'),el('input',{className:'form-input',type:'password',id:'mfaSetupPwd',placeholder:'Your password'})]));
    c.appendChild(el('button',{className:'btn btn-gold',onclick:async function(){
      var pwd=$('mfaSetupPwd').value;if(!pwd){toast('Password required','error');return}
      try{
        var d=await api('/api/auth/mfa/setup',{method:'POST',body:{password:pwd}});
        var qrEl=el('div',{style:{textAlign:'center',margin:'20px 0'}});
        try{
          var canvas=document.createElement('canvas');
          generateQR(canvas,d.otpauth_url,200);
          canvas.style.borderRadius='8px';canvas.style.border='4px solid var(--cream)';
          qrEl.appendChild(canvas);
        }catch(qe){
          qrEl.appendChild(el('div',{style:{padding:'16px',background:'var(--cream)',borderRadius:'8px',fontSize:'.85rem',color:'var(--text-light)'}},'QR code unavailable — enter the secret below manually.'));
        }
        c.replaceChildren(
          el('p',{style:{fontSize:'.88rem',marginBottom:'16px'}},'Scan this QR code with your authenticator app, or enter the secret manually:'),
          qrEl,
          el('div',{style:{textAlign:'center',margin:'12px 0',padding:'12px',background:'var(--cream)',borderRadius:'var(--radius)',fontFamily:'monospace',fontSize:'.9rem',letterSpacing:'.15em',wordBreak:'break-all'}},d.secret),
          el('div',{className:'form-group',style:{marginTop:'20px'}},[el('label',{for:'mfaVerifyCode'},'Enter the 6-digit code from your app to verify'),el('input',{className:'form-input',type:'text',id:'mfaVerifyCode',placeholder:'000000',maxlength:'6',autocomplete:'one-time-code',style:{textAlign:'center',fontSize:'1.2rem',letterSpacing:'.3em'}})]),
          el('button',{className:'btn btn-gold',onclick:async function(){
            var code=$('mfaVerifyCode').value.trim();if(code.length!==6){toast('Enter a 6-digit code','error');return}
            try{await api('/api/auth/mfa/enable',{method:'POST',body:{code:code}});toast('MFA enabled!');U.mfa_enabled=1;loadSettings()}catch(e){toast(e.message,'error')}
          }},'Verify & Enable')
        );
      }catch(e){toast(e.message,'error')}
    }},'Set Up MFA'));
  }
}
// API Key save/clear handlers
$('saveAnthropicKey').addEventListener('click',async function(){
  var key=$('settAnthropicKey').value.trim();if(!key){toast('Enter an API key','error');return}
  try{await api('/api/auth/preferences',{method:'PUT',body:{anthropic_api_key:key}});$('settAnthropicKey').value='';U.anthropic_api_key=true;$('anthropicKeyStatus').textContent='Custom key is set';$('anthropicKeyStatus').style.color='var(--green)';$('clearAnthropicKey').style.display='';toast('Anthropic API key saved')}catch(e){toast(e.message,'error')}
});
$('clearAnthropicKey').addEventListener('click',async function(){
  if(!confirm('Remove your custom Anthropic API key?'))return;
  try{await api('/api/auth/preferences',{method:'PUT',body:{anthropic_api_key:null}});U.anthropic_api_key=false;$('anthropicKeyStatus').textContent='Using platform default';$('anthropicKeyStatus').style.color='var(--text-light)';this.style.display='none';toast('Anthropic API key removed')}catch(e){toast(e.message,'error')}
});
$('saveOpenaiKey').addEventListener('click',async function(){
  var key=$('settOpenaiKey').value.trim();if(!key){toast('Enter an API key','error');return}
  try{await api('/api/auth/preferences',{method:'PUT',body:{openai_api_key:key}});$('settOpenaiKey').value='';U.openai_api_key=true;$('openaiKeyStatus').textContent='Custom key is set';$('openaiKeyStatus').style.color='var(--green)';$('clearOpenaiKey').style.display='';toast('OpenAI API key saved')}catch(e){toast(e.message,'error')}
});
$('clearOpenaiKey').addEventListener('click',async function(){
  if(!confirm('Remove your custom OpenAI API key?'))return;
  try{await api('/api/auth/preferences',{method:'PUT',body:{openai_api_key:null}});U.openai_api_key=false;$('openaiKeyStatus').textContent='Using platform default';$('openaiKeyStatus').style.color='var(--text-light)';this.style.display='none';toast('OpenAI API key removed')}catch(e){toast(e.message,'error')}
});
$('saveWeavehubKey').addEventListener('click',async function(){
  var key=$('settWeavehubKey').value.trim();if(!key){toast('Enter your wh_ai_ key','error');return}
  try{await api('/api/auth/preferences',{method:'PUT',body:{weavehub_ai_key:key}});$('settWeavehubKey').value='';U.weavehub_ai_key=true;$('weavehubKeyStatus').textContent='Key active — stored securely on the server, never displayed';$('weavehubKeyStatus').style.color='var(--green)';$('clearWeavehubKey').style.display='';toast('WeaveHub AI key saved');updateWeavehubPanel()}catch(e){toast(e.message,'error')}
});
$('clearWeavehubKey').addEventListener('click',async function(){
  if(!confirm('Remove your WeaveHub AI key?'))return;
  try{await api('/api/auth/preferences',{method:'PUT',body:{weavehub_ai_key:null}});U.weavehub_ai_key=false;$('weavehubKeyStatus').textContent='No key saved';$('weavehubKeyStatus').style.color='var(--text-light)';this.style.display='none';toast('WeaveHub AI key removed');updateWeavehubPanel()}catch(e){toast(e.message,'error')}
});
$('whBuyStarter').addEventListener('click',function(){weavehubBuy('starter')});
$('whBuyGrowth').addEventListener('click',function(){weavehubBuy('growth')});
$('whCreateKey').addEventListener('click',createWeavehubKey);
if(location.hash.indexOf('ai_topup=success')>=0){toast('Payment received — credits will appear in a few seconds');history.replaceState(null,'','#settings/ai')}
if(location.hash.indexOf('ai_topup=cancelled')>=0){toast('Checkout cancelled — no charge was made','error');history.replaceState(null,'','#settings/ai')}
$('changePwdBtn').addEventListener('click',async function(){
  var cur=$('curPwd').value,np=$('newPwd').value,cp=$('conPwd').value;
  if(!cur||!np){toast('Fill in all fields','error');return}
  if(np!==cp){$('pwdError').textContent='Passwords do not match';$('pwdError').style.display='block';return}
  if(np.length<8){$('pwdError').textContent='Password must be at least 8 characters';$('pwdError').style.display='block';return}
  try{await api('/api/auth/password',{method:'PUT',body:{current_password:cur,new_password:np}});toast('Password updated');$('curPwd').value='';$('newPwd').value='';$('conPwd').value='';$('pwdError').style.display='none'}
  catch(e){$('pwdError').textContent=e.message;$('pwdError').style.display='block'}
});

// MODAL UTILS
function openModal(){$('modalOverlay').classList.add('show')}
function closeModal(){$('modalOverlay').classList.remove('show')}
$('modalClose').addEventListener('click',closeModal);
$('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal()});
$('uploadOverlay').addEventListener('click',function(e){if(e.target===this)this.classList.remove('show')});

function formGroup(label,type,id,value,placeholder){
  return el('div',{className:'form-group'},[
    el('label',{for:id},label),
    el('input',{className:'form-input',type:type,id:id,value:value||'',placeholder:placeholder||''})
  ]);
}
function formGroupSelect(label,id,options,selected){
  var s=el('select',{className:'form-select',id:id});
  options.forEach(function(o){var opt=el('option',{value:o},o||'-- Select --');if(o===selected)opt.selected=true;s.appendChild(opt)});
  return el('div',{className:'form-group'},[el('label',{for:id},label),s]);
}

function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms)}}

// BUDGETS
function getBookId(){
  var b=$('dashBookSelect');
  var id=b?b.value:'';
  if(!id&&books.length)id=books[0].id;
  return id;
}
(function(){
  var ms=$('budgetMonth'),ys=$('budgetYear');
  if(!ms||!ys)return;
  var mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var now=new Date();
  for(var i=0;i<12;i++){var o=document.createElement('option');o.value=i+1;o.textContent=mNames[i];if(i===now.getMonth())o.selected=true;ms.appendChild(o)}
  for(var y=now.getFullYear();y>=now.getFullYear()-5;y--){var o=document.createElement('option');o.value=y;o.textContent=y;ys.appendChild(o)}
  ms.addEventListener('change',loadBudgets);
  ys.addEventListener('change',loadBudgets);
})();
// Shared "no book yet" empty state so book-scoped pages never hang on "Loading..."
// for a fresh account. Points the user at creating their first book.
function bookRequiredState(ids){
  ids.forEach(function(id){
    var e=document.getElementById(id);if(!e)return;
    e.replaceChildren(el('div',{className:'empty',style:{padding:'24px',textAlign:'center'}},[
      el('div',{className:'empty-icon'},'\uD83D\uDCD8'),
      el('p',null,'Create a book to get started.'),
      el('p',{style:{fontSize:'.85rem',color:'var(--text-light)',margin:'4px 0 14px'}},'Books hold your receipts, budgets, and reports.'),
      el('button',{className:'btn btn-gold',onclick:function(){showBookModal()}},'+ Create a book')
    ]));
  });
}
async function loadBudgets(){
  var bookId=getBookId();if(!bookId){bookRequiredState(['budgetList']);return;}
  var month=($('budgetMonth')||{}).value;
  var year=($('budgetYear')||{}).value;
  var qs='';
  if(year)qs+='?year='+year;
  if(month)qs+=(qs?'&':'?')+'month='+month;
  var mNames=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  $('budgetPeriodLabel').textContent=mNames[parseInt(month)]+ ' '+year;
  try{
    var r=await api('/api/books/'+encodeURIComponent(bookId)+'/budgets/status'+qs);
    var bs=r.data||r;
    if(!Array.isArray(bs))bs=bs.budgets||[];
    var tb=0,ts=0;bs.forEach(function(b){tb+=(b.budget?b.budget.amount:0)||0;ts+=b.spent||0;});
    var pct=tb>0?Math.round(ts/tb*100):0;
    var statsEl=$('budgetStats');
    statsEl.innerHTML='<div class="stat-card"><div class="stat-label">Total Budget</div><div class="stat-value">'+fmt(tb/100)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Total Spent</div><div class="stat-value">'+fmt(ts/100)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value">'+fmt((tb-ts)/100)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Used</div><div class="stat-value">'+pct+'%</div></div>';
    var list=$('budgetList');
    if(!bs.length){list.innerHTML='<div class="empty"><div class="empty-icon">&#x1F4CA;</div>No budgets set yet</div>';return;}
    var html='';
    bs.forEach(function(b){
      var p=b.percentUsed||b.percent_used||0;
      var color=p>90?'var(--red)':p>75?'orange':'var(--green)';
      var cat=b.budget?b.budget.category:b.category;
      var amt=b.budget?b.budget.amount:0;
      var per=b.budget?b.budget.period:(b.period||'monthly');
      html+='<div style="padding:12px 0;border-bottom:1px solid rgba(10,22,40,.04)">'
        +'<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-weight:500">'+cat+'</span><span style="font-size:.85rem;color:var(--text-light)">'+fmt(b.spent/100)+' / '+fmt(amt/100)+'</span></div>'
        +'<div style="background:var(--cream);border-radius:4px;height:8px;overflow:hidden"><div style="height:100%;width:'+Math.min(p,100)+'%;background:'+color+';border-radius:4px;transition:width .5s"></div></div>'
        +'<div style="font-size:.75rem;color:var(--text-light);margin-top:4px">'+Math.round(p)+'% used &middot; '+per+'</div></div>';
    });
    list.innerHTML=html;
  }catch(e){$('budgetList').innerHTML='<div class="empty">Failed to load budgets</div>';}
}
$('refreshBudgets')&&$('refreshBudgets').addEventListener('click',function(){this.classList.add('spinning');loadBudgets().finally(function(){$('refreshBudgets').classList.remove('spinning')})});
$('addBudgetBtn')&&$('addBudgetBtn').addEventListener('click',function(){
  var bookId=getBookId();if(!bookId){toast('No book selected','error');return}
  $('modalTitle').textContent='Add Budget';
  $('modalBody').replaceChildren(
    formGroupSelect('Category','budgetCat',[''].concat(CATS),''),
    formGroup('Amount ($)','number','budgetAmt','','100.00'),
    formGroupSelect('Period','budgetPeriod',['monthly','quarterly','yearly'],'monthly')
  );
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    el('button',{className:'btn btn-gold',onclick:async function(){
      var cat=$('budgetCat').value;var amt=parseFloat($('budgetAmt').value);var per=$('budgetPeriod').value;
      if(!cat){toast('Select a category','error');return}
      if(!amt||amt<=0){toast('Enter a valid amount','error');return}
      try{await api('/api/books/'+encodeURIComponent(bookId)+'/budgets',{method:'POST',body:{category:cat,amount:Math.round(amt*100),period:per}});toast('Budget created');closeModal();loadBudgets();}catch(e){toast(e.message,'error')}
    }},'Create')
  );openModal();
});

// EXPENSE REPORTS
var REPORT_STATUS_COLORS={draft:'#6b7280',submitted:'#c77b1e',reimbursed:'#2a7a4b'};
var openReportId=null;
function escH(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtCur(a,c){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(a||0)}catch(e){return (a||0).toFixed(2)+' '+(c||'')}}
function reportTotalsText(totals){if(!totals||!totals.length)return fmtCur(0,'USD');return totals.map(function(t){return fmtCur(t.total,t.currency)}).join(' + ')}
function reportBadge(status){var c=REPORT_STATUS_COLORS[status]||'#6b7280';return '<span style="font-size:.72rem;font-weight:600;padding:2px 10px;border-radius:12px;background:'+c+'1f;color:'+c+'">'+escH(status)+'</span>'}
async function loadReports(){
  var bookId=getBookId();if(!bookId){bookRequiredState(['reportList']);return;}
  try{
    var rs=await api('/api/books/'+encodeURIComponent(bookId)+'/reports');
    var list=$('reportList');
    if(!rs.length){list.innerHTML='<div class="empty"><div class="empty-icon">&#x1F4C4;</div>No reports yet. Click + New Report, then add receipts here or from the Expenses page.</div>';$('reportDetailCard').style.display='none';openReportId=null;return}
    var html='';
    rs.forEach(function(r){
      html+='<div class="report-row" data-rid="'+escH(r.id)+'" style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(10,22,40,.04);cursor:pointer">'
        +'<div><div style="font-weight:500">'+escH(r.title)+'</div><div style="font-size:.78rem;color:var(--text-light)">'+(r.item_count||0)+' receipt'+((r.item_count||0)===1?'':'s')+' &middot; '+fmtDate(r.created_at)+'</div></div>'
        +'<div style="display:flex;gap:12px;align-items:center"><span style="font-weight:600">'+reportTotalsText(r.totals)+'</span>'+reportBadge(r.status)+'</div></div>';
    });
    list.innerHTML=html;
    qa('.report-row').forEach(function(row){row.addEventListener('click',function(){openReport(this.dataset.rid)})});
    if(openReportId)openReport(openReportId);
  }catch(e){$('reportList').innerHTML='<div class="empty">Failed to load reports</div>'}
}
async function openReport(id){
  var bookId=getBookId();if(!bookId)return;
  try{
    var r=await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(id));
    openReportId=r.id;
    $('reportDetailCard').style.display='';
    $('reportDetailTitle').innerHTML=escH(r.title)+' '+reportBadge(r.status);
    var actions=$('reportDetailActions');actions.replaceChildren();
    function actBtn(label,cls,fn){
      var b=el('button',{className:'btn btn-sm '+cls,onclick:fn},label);
      // .btn-outline is styled for the dark hero; on the white card it needs navy.
      if(cls.indexOf('btn-outline')>=0){b.style.color='var(--navy)';b.style.borderColor='var(--navy)'}
      actions.appendChild(b);
    }
    if(r.status==='draft')actBtn('+ Add Receipts','btn-gold',function(){showAddReceiptsModal(r)});
    if(r.status==='draft')actBtn('Mark Submitted','btn-outline',function(){setReportStatus(r.id,'submitted')});
    if(r.status==='submitted'){actBtn('Mark Reimbursed','btn-gold',function(){setReportStatus(r.id,'reimbursed')});actBtn('Back to Draft','btn-outline',function(){setReportStatus(r.id,'draft')})}
    if(r.status==='reimbursed')actBtn('Reopen','btn-outline',function(){setReportStatus(r.id,'submitted')});
    actBtn('PDF','btn-outline',function(){openReportPrintView(r)});
    actBtn('CSV','btn-outline',function(){downloadReportCsv(r)});
    actBtn('Delete','btn-danger',function(){deleteReport(r)});
    var html='';
    if(r.notes)html+='<p style="color:var(--text-light);font-size:.85rem;margin-bottom:10px">'+escH(r.notes)+'</p>';
    var receipts=r.receipts||[];
    if(!receipts.length)html+='<div class="empty">No receipts on this report yet. Click + Add Receipts above, or select them on the Expenses page.</div>';
    receipts.forEach(function(rc){
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(10,22,40,.04)">'
        +'<div><div style="font-weight:500">'+escH(rc.merchant||'Unknown')+'</div><div style="font-size:.75rem;color:var(--text-light)">'+escH(rc.date||'')+' &middot; '+escH(rc.category||'')+'</div></div>'
        +'<div style="display:flex;gap:10px;align-items:center"><span>'+fmtCur(rc.amount,rc.currency)+'</span>'
        +(r.status==='draft'?'<button class="btn btn-outline btn-sm rm-item" data-rcid="'+escH(rc.id)+'" style="color:var(--red);border-color:rgba(204,68,68,.3)">Remove</button>':'')
        +'</div></div>';
    });
    html+='<div style="display:flex;justify-content:space-between;padding:12px 0 0;font-weight:700"><span>Total</span><span>'+reportTotalsText(r.totals)+'</span></div>';
    $('reportDetail').innerHTML=html;
    qa('.rm-item').forEach(function(b){b.addEventListener('click',function(ev){ev.stopPropagation();removeReportItem(r.id,this.dataset.rcid)})});
  }catch(e){toast(e.message,'error')}
}
async function showAddReceiptsModal(report){
  var bookId=getBookId();if(!bookId)return;
  var onReport={};(report.receipts||[]).forEach(function(rc){onReport[rc.id]=true});
  var picked={};
  $('modalTitle').textContent='Add Receipts to "'+report.title+'"';
  var body=$('modalBody');
  var search=el('input',{className:'filter-input',type:'text',placeholder:'Search merchant...',style:{width:'100%',marginBottom:'10px'}});
  var listWrap=el('div',{style:{maxHeight:'320px',overflowY:'auto'}},[el('div',{className:'loading'},'Loading receipts...')]);
  body.replaceChildren(search,listWrap);
  var addBtn=el('button',{className:'btn btn-gold',disabled:true,onclick:async function(){
    var ids=Object.keys(picked);if(!ids.length)return;
    try{
      await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(report.id)+'/items',{method:'POST',body:{receipt_ids:ids}});
      toast('Added '+ids.length+' receipt'+(ids.length===1?'':'s'));
      closeModal();loadReports();
    }catch(e){toast(e.message,'error')}
  }},'Add (0)');
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    addBtn
  );
  function refreshAddBtn(){var n=Object.keys(picked).length;addBtn.textContent='Add ('+n+')';addBtn.disabled=!n}
  async function fetchList(){
    var params='?status=completed&limit=50&page=1';
    var q=search.value.trim();if(q)params+='&search='+encodeURIComponent(q);
    try{
      var d=await api('/api/books/'+encodeURIComponent(bookId)+'/receipts'+params);
      var recs=(d.receipts||[]).filter(function(rc){return !onReport[rc.id]});
      listWrap.replaceChildren();
      if(!recs.length){listWrap.appendChild(el('div',{className:'empty'},'No completed receipts available to add'));return}
      recs.forEach(function(rc){
        var cb=el('input',{type:'checkbox',style:{marginRight:'10px'}});
        cb.checked=!!picked[rc.id];
        var row=el('label',{style:{display:'flex',alignItems:'center',padding:'8px 4px',borderBottom:'1px solid rgba(10,22,40,.05)',cursor:'pointer'}},[
          cb,
          el('div',{style:{flex:'1'}},[
            el('div',{style:{fontWeight:'500',fontSize:'.88rem'}},rc.merchant||'Unknown'),
            el('div',{style:{fontSize:'.72rem',color:'var(--text-light)'}},(rc.date||'')+(rc.category?' · '+rc.category:''))
          ]),
          el('span',{style:{fontWeight:'600',fontSize:'.85rem'}},fmtCur(rc.amount,rc.currency))
        ]);
        cb.addEventListener('change',function(){if(this.checked)picked[rc.id]=true;else delete picked[rc.id];refreshAddBtn()});
        listWrap.appendChild(row);
      });
    }catch(e){listWrap.replaceChildren(el('div',{className:'empty'},e.message))}
  }
  search.addEventListener('input',debounce(fetchList,350));
  openModal();
  fetchList();
}
async function setReportStatus(id,status){
  var bookId=getBookId();
  try{await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(id),{method:'PUT',body:{status:status}});toast('Report '+status);loadReports()}catch(e){toast(e.message,'error')}
}
async function removeReportItem(id,rcid){
  var bookId=getBookId();
  try{await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(id)+'/items/'+encodeURIComponent(rcid),{method:'DELETE'});loadReports()}catch(e){toast(e.message,'error')}
}
async function deleteReport(r){
  if(!confirm('Delete report "'+r.title+'"? Receipts are kept.'))return;
  var bookId=getBookId();
  try{await api('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(r.id),{method:'DELETE'});openReportId=null;$('reportDetailCard').style.display='none';toast('Report deleted');loadReports()}catch(e){toast(e.message,'error')}
}
/** Open a print-optimized report view in a new tab: report table + receipt
    image appendix. The browser's print dialog does "Save as PDF", which is
    the submittable deliverable (mirrors the iOS PDF export, incl. 40-image
    appendix cap). */
async function openReportPrintView(r){
  var bookId=getBookId();if(!bookId)return;
  var w=window.open('','_blank');
  if(!w){toast('Allow pop-ups for this site to view the PDF','error');return}
  w.document.title=r.title+' — Expense Report';
  w.document.body.innerHTML='<p style="font-family:sans-serif;padding:24px">Preparing report&hellip;</p>';
  try{
    var receipts=r.receipts||[];
    var maxImages=40;
    var withImages=receipts.filter(function(rc){return rc.image_key});
    var omitted=Math.max(0,withImages.length-maxImages);
    var imgs={};
    await Promise.all(withImages.slice(0,maxImages).map(async function(rc){
      try{
        var resp=await fetch('/api/books/'+encodeURIComponent(bookId)+'/receipts/'+encodeURIComponent(rc.id)+'/image',{headers:{'Authorization':'Bearer '+T}});
        if(resp.ok)imgs[rc.id]=URL.createObjectURL(await resp.blob());
      }catch(e){/* image missing: row still prints */}
    }));
    var html='<style>'
      +'body{font-family:Georgia,serif;color:#0A1628;margin:40px;max-width:720px}'
      +'h1{font-size:1.6rem;margin:0 0 2px}'
      +'.sub{color:#555;font-size:.85rem;margin-bottom:20px}'
      +'table{width:100%;border-collapse:collapse;font-size:.9rem}'
      +'th{text-align:left;border-bottom:2px solid #0A1628;padding:6px 8px;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}'
      +'td{border-bottom:1px solid #ddd;padding:8px}'
      +'td.amt,th.amt{text-align:right;font-variant-numeric:tabular-nums}'
      +'.total td{font-weight:bold;border-bottom:none;border-top:2px solid #0A1628}'
      +'.appendix{page-break-before:always}'
      +'.appendix h2{font-size:1.1rem}'
      +'figure{margin:0 0 24px;page-break-inside:avoid}'
      +'figure img{max-width:100%;max-height:640px;border:1px solid #ccc}'
      +'figcaption{font-size:.8rem;color:#555;margin-top:4px}'
      +'.note{font-size:.8rem;color:#555}'
      +'@media print{body{margin:12mm}}'
      +'</style>';
    html+='<h1>'+escH(r.title)+'</h1>';
    html+='<div class="sub">Expense report &middot; '+escH(r.status)+' &middot; generated '+new Date().toLocaleDateString()+(r.notes?' &middot; '+escH(r.notes):'')+'</div>';
    html+='<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="amt">Amount</th></tr></thead><tbody>';
    receipts.forEach(function(rc){
      html+='<tr><td>'+escH(rc.date||'')+'</td><td>'+escH(rc.merchant||'Unknown')+'</td><td>'+escH(rc.category||'')+'</td><td class="amt">'+fmtCur(rc.amount,rc.currency)+'</td></tr>';
    });
    html+='<tr class="total"><td colspan="3">Total</td><td class="amt">'+reportTotalsText(r.totals)+'</td></tr>';
    html+='</tbody></table>';
    var shown=withImages.slice(0,maxImages).filter(function(rc){return imgs[rc.id]});
    if(shown.length){
      html+='<div class="appendix"><h2>Receipts ('+shown.length+')</h2>';
      shown.forEach(function(rc){
        var cap=[rc.merchant||'Unknown',rc.date||'',fmtCur(rc.amount,rc.currency)].filter(Boolean).join(' — ');
        html+='<figure><img src="'+imgs[rc.id]+'" alt="'+escH(cap)+'"><figcaption>'+escH(cap)+'</figcaption></figure>';
      });
      if(omitted>0)html+='<p class="note">'+omitted+' additional receipt image'+(omitted===1?'':'s')+' omitted (appendix capped at '+maxImages+').</p>';
      html+='</div>';
    }
    w.document.body.innerHTML=html;
    var imgEls=Array.prototype.slice.call(w.document.images);
    await Promise.all(imgEls.map(function(im){return im.complete?Promise.resolve():new Promise(function(res){im.onload=res;im.onerror=res})}));
    w.focus();w.print();
  }catch(e){
    w.document.body.innerHTML='<p style="font-family:sans-serif;padding:24px">Failed to prepare report: '+escH(e.message)+'</p>';
  }
}
async function downloadReportCsv(r){
  var bookId=getBookId();
  try{
    var resp=await fetch('/api/books/'+encodeURIComponent(bookId)+'/reports/'+encodeURIComponent(r.id)+'/export/csv',{headers:{'Authorization':'Bearer '+T}});
    if(!resp.ok)throw new Error('Export failed');
    var blob=await resp.blob();var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=(r.title||'report').replace(/[^a-z0-9 _-]/gi,'_')+'.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);
  }catch(e){toast(e.message,'error')}
}
$('refreshReports')&&$('refreshReports').addEventListener('click',function(){var b=this;b.classList.add('spinning');loadReports().finally(function(){b.classList.remove('spinning')})});
$('addReportBtn')&&$('addReportBtn').addEventListener('click',function(){
  var openBooks=books.filter(function(b){return b.status!=='closed'});
  if(!openBooks.length){toast('Create an open book first','error');return}
  var bookSel=el('select',{className:'form-select',id:'reportBook'});
  openBooks.forEach(function(b){var o=el('option',{value:b.id},b.name);if(b.id===getBookId())o.selected=true;bookSel.appendChild(o)});
  $('modalTitle').textContent='New Report';
  $('modalBody').replaceChildren(
    el('div',{className:'form-group'},[el('label',{for:'reportBook'},'Book'),bookSel]),
    formGroup('Title','text','reportTitle','','Denver trip - March'),
    formGroup('Notes (optional)','text','reportNotes','','')
  );
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    el('button',{className:'btn btn-gold',onclick:async function(){
      var t=$('reportTitle').value.trim();if(!t){toast('Enter a title','error');return}
      var bookId=$('reportBook').value;if(!bookId){toast('Select a book','error');return}
      try{await api('/api/books/'+encodeURIComponent(bookId)+'/reports',{method:'POST',body:{title:t,notes:$('reportNotes').value||null}});toast('Report created');closeModal();loadReports();}catch(e){toast(e.message,'error')}
    }},'Create')
  );openModal();
});

// RECURRING EXPENSES
function editRecurring(i){
  var bookId=getBookId();if(!bookId)return;
  $('modalTitle').textContent='Edit Recurring Expense';
  $('modalBody').replaceChildren(
    formGroup('Name','text','recName',i.name||'','Expense name'),
    formGroup('Amount ($)','number','recAmt',i.amount!=null?String(i.amount):'','0.00'),
    formGroupSelect('Frequency','recFreq',['monthly','weekly','biweekly','quarterly','yearly'],i.frequency||'monthly'),
    formGroupSelect('Category','recCat',[''].concat(CATS),i.category||''),
    formGroup('Next Due Date','date','recDue',i.next_due_date||'',''),
    formGroup('Notes','text','recNotes',i.notes||'','')
  );
  var footer=el('div',{style:{display:'flex',gap:'8px',justifyContent:'space-between',width:'100%'}});
  footer.appendChild(el('button',{className:'btn btn-sm btn-danger',onclick:async function(){
    if(!confirm('Delete this recurring expense?'))return;
    try{await api('/api/books/'+encodeURIComponent(bookId)+'/recurring-expenses/'+encodeURIComponent(i.id),{method:'DELETE'});toast('Deleted','success');closeModal();loadRecurring();}catch(e){toast(e.message,'error')}
  }},'Delete'));
  var right=el('div',{style:{display:'flex',gap:'8px'}});
  right.appendChild(el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'));
  right.appendChild(el('button',{className:'btn btn-primary',onclick:async function(){
    var name=$('recName').value.trim();var amt=parseFloat($('recAmt').value);
    if(!name){toast('Name is required','error');return}
    if(isNaN(amt)||amt<=0){toast('Enter a valid amount','error');return}
    var body={name:name,amount:amt,frequency:$('recFreq').value,category:$('recCat').value||null,next_due_date:$('recDue').value||null,notes:$('recNotes').value||null};
    try{await api('/api/books/'+encodeURIComponent(bookId)+'/recurring-expenses/'+encodeURIComponent(i.id),{method:'PUT',body:body});toast('Updated','success');closeModal();loadRecurring();}catch(e){toast(e.message,'error')}
  }},'Save'));
  footer.appendChild(right);
  $('modalFooter').replaceChildren(footer);
  openModal();
}
async function loadRecurring(){
  var bookId=getBookId();if(!bookId){bookRequiredState(['recurringUpcoming','recurringList']);return;}
  try{
    var r=await api('/api/books/'+encodeURIComponent(bookId)+'/recurring-expenses');
    var items=(r.data||r)||[];
    var upcoming=items.filter(function(i){var d=new Date(i.next_due_date);var now=new Date();var diff=(d-now)/(1000*60*60*24);return diff<=30&&diff>=0;});
    var overdue=items.filter(function(i){return new Date(i.next_due_date)<new Date();});
    var active=items.filter(function(i){return i.is_active;});
    var total=active.reduce(function(s,i){return s+(i.amount||0);},0);
    var statsEl=$('recurringStats');
    statsEl.innerHTML='<div class="stat-card"><div class="stat-label">Active</div><div class="stat-value">'+active.length+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Monthly Total</div><div class="stat-value">'+fmt(total)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Upcoming (30d)</div><div class="stat-value">'+upcoming.length+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-value" style="color:'+(overdue.length?'var(--red)':'inherit')+'">'+overdue.length+'</div></div>';
    function renderRecList(arr,elId,emptyMsg){
      var el2=document.getElementById(elId);
      if(!arr.length){el2.innerHTML='<div class="empty" style="padding:20px"><div class="empty-icon">&#x1F4CB;</div>'+emptyMsg+'</div>';return;}
      var tbl=el('table');
      tbl.appendChild(el('thead',null,[el('tr',null,[el('th',null,'Name'),el('th',null,'Amount'),el('th',null,'Frequency'),el('th',null,'Next Due'),el('th',null,'Category')])]));
      var tbody=el('tbody');
      arr.forEach(function(i){
        var isOv=new Date(i.next_due_date)<new Date();
        var row=el('tr',{style:{color:isOv?'var(--red)':'',cursor:'pointer'},onclick:function(){editRecurring(i)}},[
          el('td',null,i.name),el('td',null,fmt(i.amount||0)),el('td',null,i.frequency||'monthly'),el('td',null,i.next_due_date||'\u2014'),el('td',null,i.category||'\u2014')
        ]);
        tbody.appendChild(row);
      });
      tbl.appendChild(tbody);el2.replaceChildren(tbl);
    }
    renderRecList(upcoming.concat(overdue),'recurringUpcoming','No upcoming bills');
    renderRecList(items,'recurringList','No recurring expenses');
  }catch(e){$('recurringList').innerHTML='<div class="empty">Failed to load</div>';}
}
$('refreshRecurring')&&$('refreshRecurring').addEventListener('click',function(){this.classList.add('spinning');loadRecurring().finally(function(){$('refreshRecurring').classList.remove('spinning')})});
$('addRecurringBtn')&&$('addRecurringBtn').addEventListener('click',function(){
  var bookId=getBookId();if(!bookId){toast('No book selected','error');return}
  $('modalTitle').textContent='Add Recurring Expense';
  $('modalBody').replaceChildren(
    formGroup('Name','text','recName','','e.g. Office Rent'),
    el('div',{className:'form-row'},[
      formGroup('Amount ($)','number','recAmt','','250.00'),
      formGroupSelect('Frequency','recFreq',['weekly','monthly','quarterly','yearly'],'monthly')
    ]),
    formGroupSelect('Category','recCat',[''].concat(CATS),''),
    formGroup('Next Due Date','date','recDue',''),
    formGroup('Notes','text','recNotes','','Optional')
  );
  $('modalFooter').replaceChildren(
    el('button',{className:'btn btn-outline',style:{color:'var(--navy)',borderColor:'var(--cream-dark)'},onclick:closeModal},'Cancel'),
    el('button',{className:'btn btn-gold',onclick:async function(){
      var name=$('recName').value;var amt=parseFloat($('recAmt').value);var freq=$('recFreq').value;var cat=$('recCat').value;var due=$('recDue').value;var notes=$('recNotes').value;
      if(!name){toast('Enter a name','error');return}
      if(!amt||amt<=0){toast('Enter a valid amount','error');return}
      if(!due){toast('Select a due date','error');return}
      try{await api('/api/books/'+encodeURIComponent(bookId)+'/recurring-expenses',{method:'POST',body:{name:name,amount:amt,frequency:freq,category:cat||null,next_due_date:due,notes:notes||null}});toast('Recurring expense created');closeModal();loadRecurring();}catch(e){toast(e.message,'error')}
    }},'Create')
  );openModal();
});

// TAX CENTER
(function(){
  var sel=$('taxYearSelect');
  if(sel){var y=new Date().getFullYear();for(var i=0;i<6;i++){var o=document.createElement('option');o.value=y-i;o.textContent=y-i;sel.appendChild(o)}
  sel.addEventListener('change',loadTax);}
})();
async function loadTax(){
  var bookId=getBookId();if(!bookId){bookRequiredState(['taxDeductibles','taxQuarters']);return;}
  var year=parseInt(($('taxYearSelect')||{}).value)||new Date().getFullYear();
  $('taxYearLabel').textContent=year+' Tax Year';
  try{
    var results=await Promise.all([
      api('/api/books/'+encodeURIComponent(bookId)+'/tax-summary?year='+year),
      api('/api/books/'+encodeURIComponent(bookId)+'/tax-estimates?year='+year)
    ]);
    var sum=results[0].data||results[0];var est=results[1].data||results[1];
    var statsEl=$('taxStats');
    statsEl.innerHTML='<div class="stat-card"><div class="stat-label">Total Income</div><div class="stat-value">'+fmt(est.income||0)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Deductions</div><div class="stat-value">'+fmt(est.deductions||0)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Taxable Income</div><div class="stat-value">'+fmt(est.netTaxable||0)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Effective Rate</div><div class="stat-value">'+((est.rates&&est.rates.effectiveTotal)||0).toFixed(1)+'%</div></div>';
    var dedEl=$('taxDeductibles');
    var cats=sum.categories||sum.by_category||[];
    if(!cats.length){dedEl.innerHTML='<div class="empty" style="padding:20px">No deductible expenses tagged</div>';}
    else{
      var h='<ul class="cat-list">';
      cats.forEach(function(c){h+='<li class="cat-item"><span class="cat-name">'+c.tax_category+'</span><span class="cat-amount">'+fmt(c.total||0)+'</span><span class="cat-count">'+c.count+'x</span></li>';});
      h+='</ul>';dedEl.innerHTML=h;
    }
    var qEl=$('taxQuarters');
    var qs=est.quarters||[];
    if(!qs.length){qEl.innerHTML='<div class="empty" style="padding:20px">No estimates available</div>';}
    else{
      var h2='';
      qs.forEach(function(q){
        var paid=q.paid||q.amount_paid||0,due=q.estimatedTax||q.estimated_tax||0,rem=q.remainingDue||q.remaining_due||0;
        var pct2=due>0?Math.round(paid/due*100):0;
        var isPast=new Date(q.dueDate||q.due_date)<new Date();
        var color=paid>=due?'var(--green)':paid>0?'orange':(isPast?'var(--red)':'var(--text-light)');
        h2+='<div style="padding:12px 0;border-bottom:1px solid rgba(10,22,40,.04)">'
          +'<div style="display:flex;justify-content:space-between;margin-bottom:4px"><strong>'+q.label+'</strong><span style="font-size:.82rem;color:var(--text-light)">Due: '+(q.dueDate||q.due_date)+'</span></div>'
          +'<div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:6px"><span>Estimated: '+fmt(due)+'</span><span>Paid: '+fmt(paid)+'</span><span style="color:'+color+'">Remaining: '+fmt(rem)+'</span></div>'
          +'<div style="background:var(--cream);border-radius:4px;height:6px;overflow:hidden"><div style="height:100%;width:'+Math.min(pct2,100)+'%;background:'+color+';border-radius:4px"></div></div></div>';
      });
      qEl.innerHTML=h2;
    }
  }catch(e){$('taxStats').innerHTML='<div class="empty">Failed to load tax data</div>';}
}
$('refreshTax')&&$('refreshTax').addEventListener('click',function(){this.classList.add('spinning');loadTax().finally(function(){$('refreshTax').classList.remove('spinning')})});
$('taxSettingsBtn')&&$('taxSettingsBtn').addEventListener('click',async function(){
  try{
    var r=await api('/api/tax-settings');var s=r.data||r;
    var statuses=['sole_proprietor','single_member_llc','llc_partnership','s_corp','c_corp','nonprofit'];
    var statusLabels=['Sole Proprietor','Single-Member LLC','LLC Partnership','S Corporation','C Corporation','Nonprofit'];
    $('modalTitle').textContent='Tax Settings';
    var filingSelect=formGroupSelect('Filing Status','taxFiling',[''].concat(statuses),s.filing_status||'');
    // Replace option text with labels
    var opts=filingSelect.querySelectorAll('option');
    opts.forEach(function(o,i){if(i>0&&i<=statusLabels.length)o.textContent=statusLabels[i-1]});
    $('modalBody').replaceChildren(
      filingSelect,
      formGroup('Federal Tax Rate (%)','number','taxFederal',s.estimated_annual_tax_rate!=null?String(s.estimated_annual_tax_rate):'','25'),
      formGroup('State','text','taxState',s.state||'','e.g. NY'),
      formGroup('State Tax Rate (%)','number','taxStateRate',s.state_tax_rate!=null?String(s.state_tax_rate):'','0'),
      formGroup('Self-Employment Tax Rate (%)','number','taxSERate',s.self_employment_tax_rate!=null?String(s.self_employment_tax_rate):'','15.3')
    );
    $('modalFooter').replaceChildren(el('button',{className:'btn btn-primary',onclick:async function(){
      try{
        var body={};
        var f=$('taxFiling').value;if(f)body.filing_status=f;
        var fed=parseFloat($('taxFederal').value);if(!isNaN(fed))body.estimated_annual_tax_rate=fed;
        var st=$('taxState').value.trim();body.state=st||null;
        var sr=parseFloat($('taxStateRate').value);if(!isNaN(sr))body.state_tax_rate=sr;
        var se=parseFloat($('taxSERate').value);if(!isNaN(se))body.self_employment_tax_rate=se;
        await api('/api/tax-settings',{method:'PUT',body:JSON.stringify(body)});
        closeModal();toast('Tax settings saved','success');loadTax();
      }catch(e){toast('Failed to save: '+e.message,'error')}
    }},'Save Settings'));
    openModal();
  }catch(e){toast('Failed to load tax settings','error')}
});

// PROFIT & LOSS (embedded in Overview)
(function(){
  var sel=$('pnlYear');
  if(sel){var y=new Date().getFullYear();for(var i=0;i<6;i++){var o=document.createElement('option');o.value=y-i;o.textContent=y-i;sel.appendChild(o)}
  sel.addEventListener('change',loadPnl);}
  var ps=$('pnlPeriod');if(ps)ps.addEventListener('change',loadPnl);
})();
async function loadPnl(){
  var bookId=getBookId();if(!bookId){bookRequiredState(['pnlStats']);return;}
  var period=($('pnlPeriod')||{}).value||'monthly';
  var year=parseInt(($('pnlYear')||{}).value)||new Date().getFullYear();
  try{
    var r=await api('/api/books/'+encodeURIComponent(bookId)+'/pnl?period='+period+'&year='+year);
    var d=r.data||r;
    var t=d.totals||{};
    var statsEl=$('pnlStats');
    var np=t.netProfit||0;
    statsEl.innerHTML='<div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value" style="color:var(--green)">'+fmt(t.revenue||0)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Expenses</div><div class="stat-value">'+fmt(t.expenses||0)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Net Profit</div><div class="stat-value" style="color:'+(np>=0?'var(--green)':'var(--red)')+'">'+fmt(np)+'</div></div>'
      +'<div class="stat-card"><div class="stat-label">Margin</div><div class="stat-value">'+(t.margin||0).toFixed(1)+'%</div></div>';
    var periods=d.periods||[];
    var tbody=$('pnlTable');
    if(!periods.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-light)">No data for this period</td></tr>';return;}
    var h='';
    periods.forEach(function(p){
      var pnp=p.netProfit||0;
      var color=pnp>=0?'var(--green)':'var(--red)';
      h+='<tr><td>'+p.label+'</td><td style="text-align:right">'+fmt(p.revenue||0)+'</td><td style="text-align:right">'+fmt(p.expenses||0)+'</td><td style="text-align:right;color:'+color+'">'+fmt(pnp)+'</td><td style="text-align:right">'+(p.margin||0).toFixed(1)+'%</td></tr>';
    });
    tbody.innerHTML=h;
  }catch(e){$('pnlTable').innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-light)">Failed to load P&amp;L</td></tr>';}
}

// ONBOARDING WIZARD
function receiptsInAddress(){
  var h=location.hostname, m=h.match(/^([a-z0-9-]+)\\.weaveledger\\.app$/);
  return m ? m[1]+'@receipts.weaveledger.app' : null;
}
var onbSteps=[
  {title:'Create your first book',body:'Books hold your receipts, budgets, and reports. Create one to get started — you can have more than one (personal, business, a client).',page:'dashboard',action:'newBook'},
  {title:'Add an expense',body:'Snap a photo, forward an email, or upload a PDF. WeaveHub AI extracts the merchant, amount, date, and category for you.',page:'expenses'},
  {title:'Email receipts in',body:'',page:'dashboard'}
];
var onbStep=0;
var onbResumeAfterBook=false;
function renderOnb(){
  var s=onbSteps[onbStep];
  document.getElementById('onbTitle').textContent=s.title;
  var body=s.body;
  if(onbStep===2){
    var addr=receiptsInAddress();
    body=addr ? 'The email you signed up with already works. Forward receipts to '+addr+' and they file themselves into your ledger.'
              : 'The email you signed up with already works. Once inbound email is configured on your instance, forward receipts and they file themselves.';
  }
  document.getElementById('onbBody').textContent=body;
  for(var i=0;i<3;i++)document.getElementById('onbDot'+i).className='onb-dot'+(i===onbStep?' on':'');
  document.getElementById('onbBack').style.display=onbStep===0?'none':'';
  document.getElementById('onbNext').style.display=onbStep<2?'':'none';
  document.getElementById('onbGo').textContent=onbStep===2?'Finish':'Take me there';
}
function openOnboarding(){onbStep=0;renderOnb();document.getElementById('onbOverlay').classList.add('show');}
function closeOnboarding(){document.getElementById('onbOverlay').classList.remove('show');}
function completeOnboarding(){
  closeOnboarding();
  api('/api/auth/preferences',{method:'PUT',body:{onboarding_completed:true}}).catch(function(){});
  if(U)U.onboarding_completed=true;
}
document.getElementById('onbBack').addEventListener('click',function(){if(onbStep>0){onbStep--;renderOnb();}});
document.getElementById('onbNext').addEventListener('click',function(){if(onbStep<2){onbStep++;renderOnb();}});
document.getElementById('onbSkip').addEventListener('click',completeOnboarding);
document.getElementById('onbClose').addEventListener('click',completeOnboarding);
document.getElementById('onbGo').addEventListener('click',function(){
  var step=onbSteps[onbStep];
  if(step.action==='newBook'){
    // Guided: open New Book directly, keep the walkthrough alive, and advance to
    // the next step once the book is actually created (see showBookModal).
    onbResumeAfterBook=true;
    onbStep=Math.min(onbStep+1,onbSteps.length-1);
    closeOnboarding();
    navigate('dashboard');
    showBookModal();
    return;
  }
  completeOnboarding();
  navigate(step.page);
});

// INIT — must run after all DOM helpers and event listeners are set up
if(T)showApp();
window.addEventListener('hashchange',function(){if(T){var raw=location.hash.replace('#','').split('?')[0];var parts=raw.split('/');var h=parts[0];if(h&&['dashboard','books','expenses','reports','income','subscriptions','budgets','recurring','tax','exports','settings'].indexOf(h)!==-1){navigate(h);if(h==='settings'&&parts[1])switchSettingsTab(parts[1])}}});
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src https://fonts.gstatic.com https://fonts.googleapis.com; connect-src 'self'; frame-src blob:; frame-ancestors 'none'",
    },
  });
}
