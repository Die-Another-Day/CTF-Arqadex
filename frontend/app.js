/* ═══════════════════════════════════════════════════════════════
   ARQADEX CTF PLATFORM — Frontend SPA
   UI unchanged. All data from real API.
═══════════════════════════════════════════════════════════════ */
(function(){'use strict';

/* ══ API CONFIG ══════════════════════════════════════════ */
const API = (()=>{
  const base = window.location.port === '8080' || window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api' : '/api';
  return {
    async call(endpoint, opts={}){
      const token = localStorage.getItem('arq_token');
      const res = await fetch(base+endpoint, {
        headers:{'Content-Type':'application/json','Accept':'application/json',
          ...(token?{'Authorization':'Bearer '+token}:{})},
        ...opts,
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Request failed ('+res.status+')');
      return data;
    },
    get:   (ep)       => API.call(ep),
    post:  (ep,body)  => API.call(ep,{method:'POST', body:JSON.stringify(body)}),
    put:   (ep,body)  => API.call(ep,{method:'PUT',  body:JSON.stringify(body)}),
    del:   (ep)       => API.call(ep,{method:'DELETE'}),
  };
})();

/* ══ SOCKET.IO ═══════════════════════════════════════════ */
let socket = null;
function connectSocket(eventSlug){
  const wsUrl = window.location.port==='8080'||window.location.hostname==='localhost'
    ? 'http://localhost:3001' : window.location.origin;
  if(typeof io === 'undefined') return;
  if(socket) socket.disconnect();
  socket = io(wsUrl, {transports:['websocket','polling']});
  socket.on('connect', ()=> socket.emit('join_event',{eventSlug, token:localStorage.getItem('arq_token')}));
  socket.on('scoreboard', ({scoreboard})=>{ CACHE.scoreboards[eventSlug]=scoreboard; updateLiveScoreboard(scoreboard); });
  socket.on('solve', data=> addLiveFeedItem(data));
  socket.on('announcement', data=> showToast('📢 '+data.message,'info'));
  socket.on('event_status', ({status})=>{ if(status==='ended') showToast('Event has ended','warning'); });
}

/* ══ CACHE ═══════════════════════════════════════════════ */
const CACHE = { events:null, eventDetails:{}, challenges:{}, scoreboards:{}, team:null };

/* ══ STATE ═══════════════════════════════════════════════ */
const S = {
  get user(){ const u=localStorage.getItem('arq_user'); return u?JSON.parse(u):null; },
  set user(v){ v?localStorage.setItem('arq_user',JSON.stringify(v)):localStorage.removeItem('arq_user'); },
  get token(){ return localStorage.getItem('arq_token'); },
  set token(v){ v?localStorage.setItem('arq_token',v):localStorage.removeItem('arq_token'); },
  route:'/',
  orgTab:'overview',
  solved: new Set(JSON.parse(localStorage.getItem('arq_solved')||'[]')),
  markSolved(id){ S.solved.add(id); localStorage.setItem('arq_solved',JSON.stringify([...S.solved])); },
};

/* ══ LOADING / ERROR HELPERS ═════════════════════════════ */
function pageLoad(msg='Loading...'){
  return `<div class="page-wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div style="text-align:center">
      <div style="font-size:40px;animation:spin 1s linear infinite;display:inline-block;margin-bottom:16px">⚡</div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--si)">${msg}</div>
    </div>
  </div>`;
}
function pageError(msg='Failed to load'){
  return `<div class="page-wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div style="text-align:center">
      <div style="font-size:40px;margin-bottom:16px">⚠️</div>
      <div class="title-md" style="margin-bottom:12px">LOAD ERROR</div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--si);margin-bottom:24px">${msg}</div>
      <button class="btn btn-ghost" onclick="render()">RETRY</button>
    </div>
  </div>`;
}

/* ══ ROUTER ══════════════════════════════════════════════ */
function getRoute(){ return location.hash.replace('#','').split('?')[0]||'/'; }
function navigate(path){ location.hash=path; }
window.addEventListener('hashchange',()=>{ S.route=getRoute(); render(); });

async function render(){
  const r=getRoute(); S.route=r;
  const app=document.getElementById('app-root');
  const parts=r.split('/').filter(Boolean);
  renderNav();
  setupCursorHover();
  window.scrollTo(0,0);

  app.innerHTML=pageLoad();
  try {
    if(r==='/'||r===''){          app.innerHTML=await buildLanding();    initLanding(); }
    else if(r==='/login'){        app.innerHTML=viewAuth('login');        initAuth(); }
    else if(r==='/register'){     app.innerHTML=viewAuth('register');     initAuth(); }
    else if(r==='/dashboard'){
      if(!S.user) return navigate('/login');
      app.innerHTML=await buildDashboard();
    }
    else if(r==='/events'){       app.innerHTML=await buildEvents();      initReveal(); }
    else if(parts[0]==='event'&&parts[1]){  app.innerHTML=await buildEventDetail(parts[1]); initEventDetail(); }
    else if(parts[0]==='compete'&&parts[1]){
      if(!S.user) return navigate('/login');
      app.innerHTML=await buildCompete(parts[1]); initCompete(parts[1]);
    }
    else if(parts[0]==='scoreboard'&&parts[1]){ app.innerHTML=await buildScoreboard(parts[1]); initScoreboard(); }
    else if(r==='/team'){
      if(!S.user) return navigate('/login');
      app.innerHTML=await buildTeam(); initReveal();
    }
    else if(r==='/profile'){
      if(!S.user) return navigate('/login');
      app.innerHTML=await buildProfile(); initReveal();
    }
    else if(r==='/organize'){
      if(!S.user||S.user.role==='participant') return navigate('/login');
      app.innerHTML=await buildOrganize(); initOrganize();
    }
    else if(parts[0]==='organize'&&parts[1]==='create'){ app.innerHTML=viewCreateEvent(); initReveal(); }
    else if(parts[0]==='organize'&&parts[2]==='challenges'){ app.innerHTML=await buildChallengeManager(parts[1]); initChallengeManager(); }
    else if(parts[0]==='organize'&&parts[2]==='anticheat'){  app.innerHTML=await buildAntiCheat(parts[1]); }
    else{ app.innerHTML=view404(); }
  } catch(err){
    console.error(err);
    app.innerHTML=pageError(err.message);
  }
  initReveal();
}

/* ══ NAV ══════════════════════════════════════════════════ */
function renderNav(){
  const r=S.route; const u=S.user;
  document.getElementById('nav-root').innerHTML=`
  <nav class="nav" id="main-nav">
    <a href="#/" class="nav-logo"><span class="nl-bracket">[</span>ARQADEX<span class="nl-slash">/</span>CTF<span class="nl-bracket">]</span><span class="nl-domain" style="margin-left:6px">ctf.arqadex.site</span></a>
    <div class="nav-links">
      <a href="#/events" class="nav-link ${r==='/events'?'active':''}">EVENTS</a>
      <a href="#/scoreboard/arqadex-prime-2025" class="nav-link">SCOREBOARD</a>
      <a href="https://arqadex.pages.dev" class="nav-link" target="_blank">ARCADE</a>
      <a href="https://build.arqadex.site" class="nav-link" target="_blank">BUILD</a>
    </div>
    <div class="nav-right">
      ${u?`
        <div class="nav-notif" onclick="openNotifications()" title="Notifications">🔔</div>
        <div class="nav-user" onclick="navigate('/dashboard')">
          <div class="nav-avatar">${u.username.charAt(0).toUpperCase()}</div>
          <span class="nav-uname">${u.username.toUpperCase()}</span>
        </div>
        ${u.role!=='participant'?`<a href="#/organize"><button class="btn-nav btn-register" style="font-size:8px;padding:7px 14px">ORG PANEL</button></a>`:''}
        <button class="btn-nav btn-ghost" onclick="logout()">EXIT</button>
      `:`
        <a href="#/login"><button class="btn-nav btn-login">LOGIN</button></a>
        <a href="#/register"><button class="btn-nav btn-register">JOIN</button></a>
      `}
    </div>
  </nav>`;
  window.addEventListener('scroll',()=>document.getElementById('main-nav')?.classList.toggle('scrolled',scrollY>30),{passive:true});
}

/* ══ LANDING ══════════════════════════════════════════════ */
async function buildLanding(){
  if(!CACHE.events) CACHE.events = (await API.get('/events')).events||[];
  const evs=CACHE.events;
  const live=evs.find(e=>e.status==='live');
  const upcoming=evs.filter(e=>e.status==='published').slice(0,2);
  const past=evs.filter(e=>e.status==='ended'||e.status==='archived').slice(0,2);

  return`<div class="page-wrap">
    <section class="hero">
      <div class="hero-bg-grid"></div>
      <div class="hero-content">
        ${live?`<div class="event-ticker"><span class="ticker-label"><span class="dot-live" style="display:inline-block;margin-right:6px"></span>LIVE</span><span class="ticker-sep">│</span><span class="ticker-content">${live.name} — ${live.team_count||0} teams competing</span></div>`:''}
        <div class="hero-badge"><span class="dot-live"></span>ARQADEX CTF ARENA — COMPETITIVE INTELLIGENCE PLATFORM</div>
        <h1 class="title-hero" style="margin-bottom:24px">
          <span class="gradient-text">CAPTURE</span><br>
          <span style="color:rgba(255,255,255,.12);-webkit-text-stroke:1px rgba(255,255,255,.18)">THE FLAG</span><br>
          <span style="background:linear-gradient(135deg,var(--p),var(--v));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">ARENA</span>
        </h1>
        <p style="font-family:var(--mono);font-size:14px;color:var(--si);line-height:1.8;max-width:560px;margin:0 auto 40px">World-class CTF competitions for elite offensive-security teams.<br>Host. Compete. Conquer. — Built by ARQADEX.</p>
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:60px">
          ${live?`<a href="#/event/${live.slug}"><button class="btn btn-primary btn-lg">⚡ JOIN LIVE EVENT</button></a>`:''}
          <a href="#/events"><button class="btn btn-ghost btn-lg">BROWSE EVENTS</button></a>
          ${!S.user?`<a href="#/register"><button class="btn btn-lg" style="background:rgba(255,45,166,.1);border-color:rgba(255,45,166,.4);color:var(--p)">CREATE ACCOUNT</button></a>`:''}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;flex-wrap:wrap">
          ${[['2,400+','REGISTERED TEAMS'],['12,000+','CHALLENGES SOLVED'],['48','EVENTS HOSTED'],['$50K+','PRIZE POOL']].map(([v,l],i)=>`
          <div style="padding:0 28px;text-align:center;${i<3?'border-right:1px solid rgba(255,255,255,.07)':''}">
            <div style="font-size:30px;font-weight:900;color:var(--c);font-family:var(--mono);text-shadow:0 0 20px rgba(0,245,255,.3)">${v}</div>
            <div style="font-size:8px;letter-spacing:3px;color:var(--mu);margin-top:4px">${l}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="hero-scroll"><div class="hero-scroll-line"></div><span>SCROLL</span></div>
    </section>

    ${live?`<section class="section-sm" style="padding-top:0"><div class="container">
      <div style="border:1px solid rgba(0,245,255,.2);border-radius:16px;overflow:hidden;background:rgba(5,5,20,.9)">
        <div style="padding:24px;background:linear-gradient(135deg,rgba(0,245,255,.08),rgba(122,92,255,.08));border-bottom:1px solid rgba(0,245,255,.12);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
          <div style="display:flex;align-items:center;gap:16px">
            <span class="badge badge-live"><span class="dot-live"></span> LIVE</span>
            <div><div class="title-lg" style="color:var(--c)">${live.name}</div><div style="font-family:var(--mono);font-size:11px;color:var(--si);margin-top:4px">${live.description}</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:24px">
            <div style="text-align:center"><div style="font-size:28px;font-weight:900;font-family:var(--mono);color:var(--c)" id="hero-timer">--:--:--</div><div style="font-size:8px;letter-spacing:3px;color:var(--mu)">REMAINING</div></div>
            <a href="#/event/${live.slug}"><button class="btn btn-primary">VIEW EVENT →</button></a>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
          ${[['👥',(live.team_count||0)+' TEAMS','COMPETING'],['🏆',(live.prizes||['?'])[0],'1ST PRIZE'],['⚡',(live.categories||[]).length+' CATS','CATEGORIES'],['🛡️','ACTIVE','INTEGRITY SHIELD']].map(([ic,v,l])=>`
          <div style="padding:20px;text-align:center;border-right:1px solid rgba(255,255,255,.05)">
            <div style="font-size:20px;margin-bottom:6px">${ic}</div><div style="font-size:14px;font-weight:700">${v}</div>
            <div style="font-size:8px;letter-spacing:2px;color:var(--mu);margin-top:2px">${l}</div>
          </div>`).join('')}
        </div>
      </div>
    </div></section>`:''}

    <section class="section"><div class="container">
      <div class="section-header reveal text-center"><div class="eyebrow">MISSION QUEUE</div><h2 class="title-xl">Upcoming Events</h2></div>
      <div class="grid-2" style="margin-bottom:24px">${upcoming.length?upcoming.map(e=>eventCard(e)).join(''):`<div class="card" style="grid-column:1/-1;text-align:center;padding:48px"><div style="font-family:var(--mono);font-size:12px;color:var(--si)">No upcoming events scheduled. Check back soon.</div></div>`}</div>
      <div style="text-align:center"><a href="#/events"><button class="btn btn-ghost">VIEW ALL EVENTS →</button></a></div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="container">
      <div class="section-header reveal text-center"><div class="eyebrow">INTELLIGENCE FEED</div><h2 class="title-xl">Live Scoreboard</h2></div>
      <div id="landing-sb-wrap">${await buildScoreboardWidget(live?.slug||'arqadex-prime-2025')}</div>
      <div style="text-align:center;margin-top:16px"><a href="#/scoreboard/${live?.slug||'arqadex-prime-2025'}"><button class="btn btn-ghost">FULL SCOREBOARD →</button></a></div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="container">
      <div class="section-header reveal text-center"><div class="eyebrow">PLATFORM CAPABILITIES</div><h2 class="title-xl">Built for Serious Competition</h2></div>
      <div class="grid-3">
        ${[['⚡','INTEGRITY SHIELD','Per-team flag derivatives, IP clustering detection, behavioral analysis, and honeypot challenges.','#00F5FF'],
           ['🎯','LIVE INTELLIGENCE','Real-time scoreboards, instant solve notifications, live category analytics.','#FF2DA6'],
           ['🏗️','ORGANIZER CONTROL','Full event management, challenge uploader, participant admin, anti-cheat dashboard.','#7A5CFF'],
           ['🌐','MULTI-DISCIPLINE','Web, Pwn, Crypto, RE, OSINT, DFIR, Stego, Malware, AI, Cloud — all supported.','#C7FF4D'],
           ['🎮','RICH PARTICIPANT UX','Team management, achievements, progress tracking, notifications, writeups.','#FF8800'],
           ['📊','POST-EVENT','Complete archives, writeup publishing, educational content, community interaction.','#00FFAA'],
          ].map(([ic,t,d,c])=>`
        <div class="card card-glow reveal" style="--top-color:${c}">
          <div style="font-size:28px;margin-bottom:14px">${ic}</div>
          <div class="title-sm" style="color:${c};margin-bottom:10px">${t}</div>
          <p style="font-family:var(--mono);font-size:11px;color:var(--si);line-height:1.8">${d}</p>
        </div>`).join('')}
      </div>
    </div></section>

    ${past.length?`<section class="section" style="padding-top:0"><div class="container">
      <div class="section-header reveal"><div class="eyebrow">ARCHIVES</div><h2 class="title-xl">Past Events</h2></div>
      <div class="grid-2">${past.map(e=>eventCard(e,'compact')).join('')}</div>
    </div></section>`:''}

    <section class="section" style="padding-top:0"><div class="container">
      <div style="text-align:center;padding:80px 40px;background:rgba(5,5,20,.6);border:1px solid rgba(0,245,255,.1);border-radius:20px;position:relative;overflow:hidden" class="reveal">
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,245,255,.05),transparent 70%);pointer-events:none"></div>
        <div class="eyebrow">ARE YOU READY?</div>
        <h2 class="title-xl" style="margin-bottom:20px">Enter the Arena</h2>
        <p style="font-family:var(--mono);font-size:13px;color:var(--si);max-width:480px;margin:0 auto 36px;line-height:1.8">Join thousands of security researchers. Compete. Build your reputation.</p>
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
          ${!S.user?`<a href="#/register"><button class="btn btn-primary btn-lg">CREATE ACCOUNT</button></a>`:`<a href="#/dashboard"><button class="btn btn-primary btn-lg">GO TO DASHBOARD</button></a>`}
          <a href="#/events"><button class="btn btn-ghost btn-lg">BROWSE EVENTS</button></a>
          <a href="https://build.arqadex.site" target="_blank"><button class="btn btn-lg" style="border-color:rgba(255,45,166,.3);color:var(--p);background:rgba(255,45,166,.06)">HOST A CTF</button></a>
        </div>
      </div>
    </div></section>

    <footer style="border-top:1px solid rgba(255,255,255,.05);padding:48px 0 28px"><div class="container">
      <div class="grid-4" style="margin-bottom:36px">
        <div><div style="font-size:16px;font-weight:900;letter-spacing:3px;margin-bottom:12px">ARQADEX<span style="color:var(--p)">/</span>CTF</div><p style="font-family:var(--mono);font-size:11px;color:var(--si);line-height:1.7">Competitive intelligence arena. World-class CTF hosting.</p></div>
        ${[['PLATFORM',['Events','Scoreboard','Achievements','Teams']],['ECOSYSTEM',['arqadex.site','build.arqadex.site','Arcade Lab']],['CONTACT',['ctf@arqadex.site','Discord','Twitter']]].map(([t,ls])=>`
        <div><div style="font-size:9px;letter-spacing:4px;color:var(--mu);margin-bottom:14px">${t}</div>${ls.map(l=>`<div style="font-family:var(--mono);font-size:11px;color:var(--si);margin-bottom:8px">${l}</div>`).join('')}</div>`).join('')}
      </div>
      <div class="neon-divider"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;flex-wrap:wrap;gap:10px">
        <span style="font-family:var(--mono);font-size:9px;color:var(--mu)">© 2025 ARQADEX CTF DIVISION</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:4px;color:rgba(255,45,166,.35)">BUILT FOR CHAOS.</span>
      </div>
    </div></footer>
  </div>`;
}

async function buildScoreboardWidget(slug){
  try {
    const {scoreboard=[]} = await API.get('/events/'+slug+'/scoreboard');
    if(!scoreboard.length) return `<div class="card" style="text-align:center;padding:32px"><div style="font-family:var(--mono);font-size:12px;color:var(--si)">No teams registered yet.</div></div>`;
    return `<div class="scoreboard reveal">
      <div class="sb-header"><span style="font-size:10px;letter-spacing:3px;color:var(--mu)">RANK / TEAM</span><span style="font-size:10px;letter-spacing:3px;color:var(--mu)">SCORE</span></div>
      ${scoreboard.slice(0,6).map((t,i)=>`
      <div class="sb-row">
        <div class="sb-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i<3?['🥇','🥈','🥉'][i]:'#'+(i+1)}</div>
        <div class="sb-team">
          <div class="sb-avatar" style="background:rgba(0,245,255,.15);color:var(--c)">${t.name.charAt(0)}</div>
          <div><div style="font-size:12px;font-weight:700">${t.name}</div><div style="font-family:var(--mono);font-size:9px;color:var(--mu)">${t.solve_count} solves</div></div>
        </div>
        <div></div><div class="sb-score">${t.score.toLocaleString()}</div><div></div>
      </div>`).join('')}
    </div>`;
  } catch { return `<div class="card" style="text-align:center;padding:32px"><div style="font-family:var(--mono);font-size:12px;color:var(--si)">Scoreboard loading...</div></div>`; }
}

function eventCard(e,mode='full'){
  const sb=e.status==='live'?'badge-live':e.status==='published'?'badge-upcoming':'badge-past';
  const cats=(e.categories||[]);
  return`<div class="event-card card-glow reveal" style="--top-color:${e.accent_color||'#00F5FF'};cursor:pointer" onclick="navigate('/event/${e.slug}')">
    <div class="ec-banner" style="background:${e.banner||'linear-gradient(135deg,#020228,#0A0A3A)'}">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 20px,rgba(255,255,255,.015) 20px,rgba(255,255,255,.015) 40px)"></div>
      <span class="badge ${sb}">${e.status==='live'?'⚡ LIVE':e.status==='published'?'UPCOMING':'COMPLETED'}</span>
    </div>
    <div class="ec-body">
      <div class="ec-name">${e.name}</div>
      <div class="ec-meta">
        <span class="ec-meta-item">👥 ${e.team_count||0}${e.max_teams?' / '+e.max_teams:''}</span>
        <span class="ec-meta-item">⏱ 48h</span>
        ${e.top_teams?.[0]?`<span class="ec-meta-item">🏆 ${e.top_teams[0].name}</span>`:''}
      </div>
      ${mode==='full'?`<p style="font-family:var(--mono);font-size:11px;color:var(--si);line-height:1.7;margin-bottom:14px">${e.description}</p>`:''}
      <div class="ec-stats">
        <div class="ec-stat"><div class="ec-stat-val" style="color:${e.accent_color||'var(--c)'}">${(e.prizes||['?'])[0]}</div><div class="ec-stat-lbl">1ST PRIZE</div></div>
        <div class="ec-stat"><div class="ec-stat-val">${cats.length}</div><div class="ec-stat-lbl">CATEGORIES</div></div>
        <div class="ec-stat"><div class="ec-stat-val">${e.team_count||0}</div><div class="ec-stat-lbl">TEAMS</div></div>
      </div>
    </div>
    <div class="ec-footer">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${cats.slice(0,4).map(c=>`<span class="badge badge-cat" style="color:var(--cat-${c});border-color:var(--cat-${c})">${c.toUpperCase()}</span>`).join('')}</div>
      <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();navigate('/event/${e.slug}')">VIEW →</button>
    </div>
  </div>`;
}

/* ══ AUTH ════════════════════════════════════════════════ */
function viewAuth(mode){ return`
  <div class="auth-page"><div class="auth-card">
    <div class="auth-logo"><div style="font-size:22px;font-weight:900;letter-spacing:4px">ARQADEX<span style="color:var(--p)">/</span><span style="color:var(--c)">CTF</span></div><div style="font-size:10px;letter-spacing:3px;color:var(--mu);margin-top:6px">${mode==='login'?'AUTHENTICATE':'CREATE ACCOUNT'}</div></div>
    ${mode==='register'?`<div class="role-select" id="role-select">
      <div class="role-card selected" data-role="participant" onclick="selectRole('participant')"><div class="role-icon">🎯</div><div class="role-name">PARTICIPANT</div><div style="font-family:var(--mono);font-size:9px;color:var(--mu);margin-top:4px">Compete in CTFs</div></div>
      <div class="role-card" data-role="organizer" onclick="selectRole('organizer')"><div class="role-icon">⚙️</div><div class="role-name">ORGANIZER</div><div style="font-family:var(--mono);font-size:9px;color:var(--mu);margin-top:4px">Host CTF events</div></div>
    </div>`:''}
    <div id="auth-error" style="display:none;background:rgba(255,32,32,.08);border:1px solid rgba(255,32,32,.25);border-radius:8px;padding:10px 14px;font-family:var(--mono);font-size:11px;color:var(--re);margin-bottom:16px"></div>
    <form id="auth-form" onsubmit="handleAuth(event,'${mode}')">
      <div style="display:flex;flex-direction:column;gap:16px">
        ${mode==='register'?`<div class="form-group"><label class="form-label">USERNAME</label><input class="form-input" type="text" id="inp-username" placeholder="ghost_root" required minlength="3" maxlength="20"></div>`:''}
        <div class="form-group"><label class="form-label">EMAIL</label><input class="form-input" type="email" id="inp-email" placeholder="operator@arqadex.site" required></div>
        <div class="form-group"><label class="form-label">PASSWORD</label><input class="form-input" type="password" id="inp-password" placeholder="••••••••••" required minlength="6"></div>
        ${mode==='register'?`<label style="display:flex;align-items:flex-start;gap:10px;cursor:none"><input type="checkbox" required style="margin-top:2px;accent-color:var(--c)"><span style="font-family:var(--mono);font-size:10px;color:var(--si);line-height:1.6">I agree to the platform rules. No flag sharing. Violations result in disqualification.</span></label>`:''}
      </div>
      <button type="submit" id="auth-submit" class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:24px">${mode==='login'?'ACCESS ARENA':'CREATE OPERATIVE'}</button>
    </form>
    <div style="text-align:center;margin-top:18px;font-family:var(--mono);font-size:11px;color:var(--si)">
      ${mode==='login'?`No account? <a href="#/register" style="color:var(--c)">Register →</a>`:`Already registered? <a href="#/login" style="color:var(--c)">Login →</a>`}
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.06);margin-top:22px;padding-top:16px;text-align:center">
      <div style="font-size:8px;letter-spacing:2px;color:var(--mu);margin-bottom:8px">DEMO — Organiser: org@arqadex.site / arqadex2025</div>
    </div>
  </div></div>`; }

/* ══ DASHBOARD ════════════════════════════════════════════ */
async function buildDashboard(){
  const u = S.user;
  let teamData=null, myEvents=[];
  try { const r=await API.get('/teams/my'); teamData=r.team; } catch{}
  try {
    if(!CACHE.events) CACHE.events=(await API.get('/events')).events||[];
    myEvents=CACHE.events.filter(e=>e.status==='live'||e.status==='published').slice(0,3);
  } catch{}

  return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;flex-wrap:wrap;gap:16px">
      <div><div class="eyebrow">OPERATIVE DASHBOARD</div><h1 class="title-xl">Welcome back, <span class="text-c">${u.username.toUpperCase()}</span></h1></div>
      <div style="display:flex;gap:10px">
        ${myEvents.find(e=>e.status==='live')?`<a href="#/compete/${myEvents.find(e=>e.status==='live').slug}"><button class="btn btn-primary">⚡ ACTIVE EVENT</button></a>`:''}
        <a href="#/team"><button class="btn btn-ghost">TEAM PANEL</button></a>
      </div>
    </div>
    ${myEvents.find(e=>e.status==='live')?`
    <div style="background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.15);border-radius:16px;padding:24px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px" class="reveal">
      <div style="display:flex;align-items:center;gap:16px">
        <span class="badge badge-live"><span class="dot-live"></span> LIVE</span>
        <div><div class="title-md">${myEvents.find(e=>e.status==='live').name}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--si)">${teamData?'Team: '+teamData.name+' · ':''}</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:24px">
        <div style="text-align:center"><div style="font-size:28px;font-weight:900;font-family:var(--mono);color:var(--c)" id="dash-timer">--:--:--</div><div style="font-size:8px;letter-spacing:2px;color:var(--mu)">REMAINING</div></div>
        <a href="#/compete/${myEvents.find(e=>e.status==='live').slug}"><button class="btn btn-primary">ENTER →</button></a>
      </div>
    </div>`:''}
    <div class="grid-4" style="margin-bottom:24px">
      ${[['🎯',S.solved.size,'CHALLENGES SOLVED'],['👥',teamData?teamData.name:'No Team','YOUR TEAM'],['🌐',myEvents.filter(e=>e.status==='live').length,'LIVE EVENTS'],['⭐',u.role.toUpperCase(),'ROLE']].map(([ic,v,l])=>`<div class="stat-card reveal"><div style="font-size:22px;margin-bottom:8px">${ic}</div><div class="sc-val" style="font-size:${typeof v==='string'&&v.length>8?'16px':'32px'}">${v}</div><div class="sc-lbl">${l}</div></div>`).join('')}
    </div>
    <div class="grid-2">
      <div class="card reveal">
        <div class="title-sm" style="margin-bottom:16px">UPCOMING / LIVE EVENTS</div>
        ${myEvents.length?myEvents.map(e=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div><div style="font-size:13px;font-weight:700">${e.name}</div><div style="font-family:var(--mono);font-size:10px;color:var(--mu)">${e.team_count||0} teams registered</div></div>
          <a href="#/${e.status==='live'?'compete':'event'}/${e.slug}"><button class="btn btn-sm btn-${e.status==='live'?'primary':'ghost'}">${e.status==='live'?'COMPETE':'VIEW'}</button></a>
        </div>`).join(''):`<div style="font-family:var(--mono);font-size:12px;color:var(--si);padding:20px 0">No active events. <a href="#/events" style="color:var(--c)">Browse events →</a></div>`}
      </div>
      <div class="card reveal">
        <div class="title-sm" style="margin-bottom:16px">TEAM STATUS</div>
        ${teamData?`
        <div style="margin-bottom:16px"><div style="font-size:18px;font-weight:700;margin-bottom:6px">${teamData.name}</div><div style="font-family:var(--mono);font-size:10px;color:var(--si)">Invite code: <strong style="color:var(--c)">${teamData.invite_code}</strong></div></div>
        <div style="display:flex;flex-direction:column;gap:8px">${(teamData.members||[]).map(m=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--c),var(--v));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${m.username.charAt(0).toUpperCase()}</div>
          <div style="font-family:var(--mono);font-size:11px">${m.username}</div>
          ${m.is_captain?`<span class="chip" style="color:var(--li);border-color:var(--li);margin-left:auto">CAPTAIN</span>`:''}
        </div>`).join('')}</div>`:`
        <div style="text-align:center;padding:24px 0">
          <div style="font-family:var(--mono);font-size:12px;color:var(--si);margin-bottom:16px">You are not in a team yet.</div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn-primary" onclick="showCreateTeam()">CREATE TEAM</button>
            <button class="btn btn-ghost" onclick="showJoinTeam()">JOIN TEAM</button>
          </div>
        </div>`}
      </div>
    </div>
  </div></div>`;
}

/* ══ EVENTS PAGE ══════════════════════════════════════════ */
async function buildEvents(){
  if(!CACHE.events) CACHE.events=(await API.get('/events')).events||[];
  const evs=CACHE.events;
  return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div class="section-header reveal"><div class="eyebrow">MISSION REGISTRY</div><h2 class="title-xl">All Events</h2></div>
    ${evs.filter(e=>e.status==='live').length?`<div style="margin-bottom:28px"><div style="font-size:9px;letter-spacing:4px;color:var(--li);margin-bottom:14px">LIVE NOW</div><div class="grid-2">${evs.filter(e=>e.status==='live').map(e=>eventCard(e)).join('')}</div></div>`:''}
    ${evs.filter(e=>e.status==='published').length?`<div style="margin-bottom:28px"><div style="font-size:9px;letter-spacing:4px;color:var(--c);margin-bottom:14px">UPCOMING</div><div class="grid-2">${evs.filter(e=>e.status==='published').map(e=>eventCard(e)).join('')}</div></div>`:''}
    ${evs.filter(e=>e.status==='ended'||e.status==='archived').length?`<div><div style="font-size:9px;letter-spacing:4px;color:var(--mu);margin-bottom:14px">PAST</div><div class="grid-2">${evs.filter(e=>e.status==='ended'||e.status==='archived').map(e=>eventCard(e,'compact')).join('')}</div></div>`:''}
    ${!evs.length?`<div class="card" style="text-align:center;padding:64px"><div style="font-size:32px;margin-bottom:16px">📭</div><div style="font-family:var(--mono);font-size:12px;color:var(--si)">No events yet. Check back soon.</div></div>`:''}
  </div></div>`;
}

/* ══ EVENT DETAIL ═════════════════════════════════════════ */
async function buildEventDetail(slug){
  const {event:e}=await API.get('/events/'+slug);
  const cats=e.categories||[];
  return`<div class="page-wrap">
    <div style="height:260px;background:${e.banner||'linear-gradient(135deg,#020228,#0A0A3A)'};position:relative;display:flex;align-items:flex-end;padding:40px">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 20px,rgba(255,255,255,.01) 20px,rgba(255,255,255,.01) 40px)"></div>
      <div style="position:relative;z-index:2;width:100%;padding:0 32px;max-width:1312px;margin:0 auto">
        <span class="badge ${e.status==='live'?'badge-live':e.status==='published'?'badge-upcoming':'badge-past'}" style="margin-bottom:12px">${e.status.toUpperCase()}</span>
        <h1 class="title-xl" style="color:${e.accent_color||'#00F5FF'}">${e.name}</h1>
        <p style="font-family:var(--mono);font-size:13px;color:rgba(255,255,255,.45);margin-top:8px">${e.description}</p>
      </div>
    </div>
    <div class="container" style="padding-top:36px"><div class="grid-2">
      <div>
        <div class="card reveal" style="margin-bottom:18px">
          <div class="title-sm" style="margin-bottom:16px">EVENT INFO</div>
          ${[['📅','START',e.start_time?new Date(e.start_time).toUTCString().slice(0,22)+' UTC':'TBA'],
             ['🏁','END',e.end_time?new Date(e.end_time).toUTCString().slice(0,22)+' UTC':'TBA'],
             ['👥','TEAM SIZE','Up to '+(e.team_size||4)+' members'],
             ['🎯','FORMAT','Jeopardy-style CTF'],
             ['🏆','PRIZES',(e.prizes||[]).join(' · ')||'TBA'],
             ['🛡️','INTEGRITY','Integrity Shield Active'],
             ['👤','ORGANIZER',e.organizer||'ARQADEX']].map(([ic,l,v])=>`
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
            <span style="font-size:18px;width:24px">${ic}</span>
            <div><div style="font-size:8px;letter-spacing:2px;color:var(--mu)">${l}</div><div style="font-family:var(--mono);font-size:12px;margin-top:2px">${v}</div></div>
          </div>`).join('')}
        </div>
        <div class="card reveal"><div class="title-sm" style="margin-bottom:14px">CATEGORIES</div><div style="display:flex;flex-wrap:wrap;gap:8px">${cats.map(c=>`<span class="badge badge-cat" style="color:var(--cat-${c});border-color:var(--cat-${c})">${c.toUpperCase()}</span>`).join('')}</div></div>
      </div>
      <div>
        <div class="card reveal" style="margin-bottom:18px;border-color:rgba(0,245,255,.15)">
          <div class="title-sm" style="margin-bottom:16px;color:var(--c)">${e.status==='live'?'JOIN NOW':'REGISTRATION'}</div>
          ${e.status==='live'?`
          <div style="text-align:center;padding:16px 0;margin-bottom:20px"><div style="font-size:40px;font-weight:900;color:var(--c);font-family:var(--mono)" id="event-timer">--:--:--</div><div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-top:6px">TIME REMAINING</div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
            <div style="background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.08);border-radius:8px;padding:14px;text-align:center"><div style="font-size:20px;margin-bottom:4px">👥</div><div style="font-size:22px;font-weight:900;color:var(--c)">${e.team_count||0}</div><div style="font-size:8px;letter-spacing:2px;color:var(--mu);margin-top:2px">TEAMS</div></div>
            <div style="background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.08);border-radius:8px;padding:14px;text-align:center"><div style="font-size:20px;margin-bottom:4px">⚡</div><div style="font-size:22px;font-weight:900;color:var(--c)">${cats.length}</div><div style="font-size:8px;letter-spacing:2px;color:var(--mu);margin-top:2px">CATEGORIES</div></div>
          </div>
          <a href="#/compete/${e.slug}"><button class="btn btn-primary btn-lg" style="width:100%;justify-content:center">⚡ ENTER COMPETITION</button></a>
          <a href="#/scoreboard/${e.slug}"><button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px">SCOREBOARD</button></a>`:`
          <div style="margin-bottom:18px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-family:var(--mono);font-size:11px;color:var(--si)">Spots</span><span style="font-family:var(--mono);font-size:11px;color:var(--c)">${e.team_count||0} / ${e.max_teams||500}</span></div><div class="progress-bar"><div class="progress-fill progress-c" style="width:${Math.round((e.team_count||0)/(e.max_teams||500)*100)}%"></div></div></div>
          ${S.user?`<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center" id="reg-btn" onclick="registerForEvent('${e.slug}')">REGISTER TEAM</button><div id="reg-msg" style="margin-top:10px"></div>`:`<a href="#/register"><button class="btn btn-primary btn-lg" style="width:100%;justify-content:center">SIGN UP TO REGISTER</button></a>`}`}
        </div>
        ${e.top_teams?.length?`<div class="card reveal"><div class="title-sm" style="margin-bottom:14px">FINAL RESULTS</div>${e.top_teams.map((t,i)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)"><div class="sb-rank ${['gold','silver','bronze'][i]}">${['🥇','🥈','🥉'][i]}</div><div style="flex:1;font-size:12px;font-weight:700">${t.name}</div><div class="sb-score" style="font-size:16px">${t.score.toLocaleString()}</div></div>`).join('')}<a href="#/scoreboard/${e.slug}"><button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:14px">FULL RESULTS →</button></a></div>`:'' }
      </div>
    </div></div></div>`;
}

/* ══ COMPETITION ══════════════════════════════════════════ */
async function buildCompete(slug){
  const {event:e}=await API.get('/events/'+slug);
  let challenges=[];
  try { const r=await API.get('/events/'+slug+'/challenges'); challenges=r.challenges||[]; } catch{}
  const cats=['all',...new Set(challenges.map(c=>c.category))];
  const {scoreboard=[]}=await API.get('/events/'+slug+'/scoreboard').catch(()=>({scoreboard:[]}));
  const myTeam=scoreboard.find(t=>S.user&&t.members?.includes(S.user.username));

  return`<div style="padding-top:60px;height:calc(100vh - 60px)">
    <div style="background:rgba(2,2,12,.95);border-bottom:1px solid rgba(255,255,255,.06);padding:10px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:16px"><span class="badge badge-live"><span class="dot-live"></span> LIVE</span><div class="title-sm">${e.name}</div></div>
      <div style="display:flex;align-items:center;gap:20px">
        ${myTeam?`<div style="text-align:center"><div style="font-size:10px;letter-spacing:3px;color:var(--mu)">TEAM</div><div style="font-weight:700;color:var(--c)">${myTeam.name}</div></div>
        <div style="text-align:center"><div style="font-size:10px;letter-spacing:3px;color:var(--mu)">SCORE</div><div style="font-weight:900;font-size:20px;color:var(--c);font-family:var(--mono)" id="live-score">${myTeam.score}</div></div>
        <div style="text-align:center"><div style="font-size:10px;letter-spacing:3px;color:var(--mu)">RANK</div><div style="font-weight:700;font-size:20px" id="live-rank">#${myTeam.rank}</div></div>`:''}
        <div style="font-size:28px;font-weight:900;color:var(--c);font-family:var(--mono)" id="compete-timer">--:--:--</div>
        <a href="#/scoreboard/${slug}"><button class="btn btn-sm btn-ghost">BOARD</button></a>
      </div>
    </div>
    <div class="compete-layout" style="height:calc(100% - 56px)">
      <div class="compete-main">
        <div class="cat-tabs" id="cat-tabs">
          ${cats.map((c,i)=>`<button class="cat-tab ${i===0?'active':''}" data-cat="${c}" style="--tab-color:var(--cat-${c},var(--c))" onclick="filterChallenges('${c}')">${c.toUpperCase()} <span style="opacity:.5;font-size:9px">${c==='all'?challenges.length:challenges.filter(ch=>ch.category===c).length}</span></button>`).join('')}
        </div>
        <div class="ch-grid" id="ch-grid">
          ${challenges.length?challenges.map(c=>challengeCard(c)).join(''):`<div style="grid-column:1/-1;text-align:center;padding:48px"><div style="font-family:var(--mono);font-size:12px;color:var(--si)">Challenges will appear when the event starts.</div></div>`}
        </div>
      </div>
      <div class="compete-sidebar">
        <div class="compete-timer">
          <div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-bottom:8px">TIME REMAINING</div>
          <div class="timer-digits" id="sidebar-timer">--:--:--</div>
          <div style="margin-top:10px"><div class="progress-bar"><div class="progress-fill progress-c" id="timer-bar" style="width:100%"></div></div></div>
        </div>
        ${myTeam?`<div class="team-score-display"><div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-bottom:4px">${myTeam.name}</div><div class="tsd-score" id="tsd-score">${myTeam.score}</div><div class="tsd-rank">RANK #${myTeam.rank}</div>
          <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px">
            <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:8px;text-align:center"><div style="font-weight:700;font-size:14px">${myTeam.solve_count}</div><div style="color:var(--mu)">SOLVED</div></div>
            <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:8px;text-align:center"><div style="font-weight:700;font-size:14px">${challenges.length-myTeam.solve_count}</div><div style="color:var(--mu)">LEFT</div></div>
          </div></div>`:''}
        <div style="font-size:8px;letter-spacing:3px;color:var(--mu);margin-bottom:8px">TOP TEAMS</div>
        <div id="sb-mini">${scoreboard.slice(0,8).map((t,i)=>`
          <div style="display:flex;align-items:center;gap:7px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.04)${myTeam&&t.id===myTeam.id?';background:rgba(0,245,255,.06);border-radius:6px;padding:8px;':''}">
            <span style="font-size:10px;color:${i<3?['#FFD700','#C0C0C0','#CD7F32'][i]:'var(--mu)'};min-width:16px;font-weight:700">#${i+1}</span>
            <div class="sb-avatar" style="width:20px;height:20px;font-size:8px;background:rgba(0,245,255,.15);color:var(--c)">${t.name.charAt(0)}</div>
            <span style="flex:1;font-size:10px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--c)">${t.score}</span>
          </div>`).join('')}</div>
        <div style="font-size:8px;letter-spacing:3px;color:var(--mu);margin:12px 0 8px">LIVE FEED</div>
        <div id="live-feed" class="notif-feed"></div>
      </div>
    </div>
  </div>`;
}

function challengeCard(c){
  const solved=S.solved.has(c.id)||c.solved;
  return`<div class="ch-card ${solved?'solved':''}" data-cat="${c.category}" style="--cat-c:var(--cat-${c.category})" onclick="openChallenge('${c.id}')">
    ${c.first_blood_team&&!solved?`<div class="first-blood">🩸</div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <span class="chip" style="font-size:7px;color:var(--cat-${c.category});border-color:var(--cat-${c.category})">${c.category.toUpperCase()}</span>
      <span class="ch-solves">${c.solve_count} solves</span>
    </div>
    <div class="ch-name">${c.name}</div>
    <div class="ch-pts">${c.points}<span style="font-size:10px;color:var(--mu);font-weight:400"> pts</span></div>
    <div class="ch-diff">${Array.from({length:5},(_,i)=>`<div class="ch-diff-pip ${i<c.difficulty?'filled':''}"></div>`).join('')}</div>
  </div>`;
}

/* ══ SCOREBOARD ═══════════════════════════════════════════ */
async function buildScoreboard(slug){
  const {event:e}=await API.get('/events/'+slug);
  const {scoreboard=[]}=await API.get('/events/'+slug+'/scoreboard');
  return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:16px" class="reveal">
      <div><div class="eyebrow">LIVE INTELLIGENCE</div><h1 class="title-xl">SCOREBOARD</h1><div style="font-family:var(--mono);font-size:12px;color:var(--si);margin-top:6px">${e.name} · <span style="color:var(--c)">${scoreboard.length} teams</span></div></div>
      <div style="display:flex;gap:12px;align-items:center">
        ${e.status==='live'?`<div style="text-align:center"><div style="font-family:var(--mono);font-size:28px;font-weight:900;color:var(--c)" id="sb-timer">--:--:--</div><div style="font-size:8px;letter-spacing:3px;color:var(--mu)">REMAINING</div></div>`:''}
        <a href="#/compete/${slug}"><button class="btn btn-primary">COMPETE →</button></a>
      </div>
    </div>
    <div class="scoreboard reveal">
      <div class="sb-header"><span style="font-size:10px;letter-spacing:3px;color:var(--mu)">RANK / TEAM</span><span style="font-size:10px;letter-spacing:3px;color:var(--mu)">SCORE / SOLVES</span></div>
      ${scoreboard.length?scoreboard.map((t,i)=>`
      <div class="sb-row ${S.user&&t.members?.includes(S.user.username)?'highlight':''}">
        <div class="sb-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i<3?['🥇','🥈','🥉'][i]:'#'+(i+1)}</div>
        <div class="sb-team">
          <div class="sb-avatar" style="background:rgba(0,245,255,.15);color:var(--c);width:32px;height:32px;font-size:13px">${t.name.charAt(0)}</div>
          <div><div style="font-size:13px;font-weight:700">${t.name}</div><div style="font-family:var(--mono);font-size:9px;color:var(--mu)">${(t.members||[]).length} members</div></div>
        </div>
        <div></div><div class="sb-score">${t.score.toLocaleString()}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--si)">${t.solve_count} solves</div>
      </div>`).join(''):`<div style="padding:40px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--si)">No teams registered yet.</div>`}
    </div>
  </div></div>`;
}

/* ══ TEAM ═════════════════════════════════════════════════ */
async function buildTeam(){
  let teamData=null;
  try { const r=await API.get('/teams/my'); teamData=r.team; } catch{}
  if(!teamData) return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div style="margin-bottom:28px"><div class="eyebrow">TEAM OPS</div><h1 class="title-xl">YOUR TEAM</h1></div>
    <div class="card reveal" style="max-width:480px;margin:0 auto;text-align:center;padding:48px">
      <div style="font-size:48px;margin-bottom:20px">👥</div>
      <div class="title-md" style="margin-bottom:12px">NO TEAM YET</div>
      <p style="font-family:var(--mono);font-size:12px;color:var(--si);margin-bottom:28px;line-height:1.7">Create a team or join one with an invite code to start competing.</p>
      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn btn-primary" onclick="showCreateTeam()">CREATE TEAM</button>
        <button class="btn btn-ghost" onclick="showJoinTeam()">JOIN WITH CODE</button>
      </div>
    </div>
  </div></div>`;
  return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;flex-wrap:wrap;gap:16px">
      <div><div class="eyebrow">TEAM OPS</div><h1 class="title-xl">${teamData.name}</h1></div>
      <div style="display:flex;gap:10px"><button class="btn btn-primary" onclick="navigator.clipboard.writeText('${teamData.invite_code}').then(()=>showToast('Invite code copied!','success'))">📋 COPY INVITE CODE</button></div>
    </div>
    <div class="card reveal" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><div class="title-sm">MEMBERS (${(teamData.members||[]).length}/4)</div><div style="font-family:var(--mono);font-size:10px;color:var(--c)">Code: ${teamData.invite_code}</div></div>
      ${(teamData.members||[]).map(m=>`
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--c),var(--v));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">${m.username.charAt(0).toUpperCase()}</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:700">${m.username}</div></div>
        ${m.is_captain?`<span class="chip" style="color:var(--li);border-color:var(--li)">CAPTAIN</span>`:''}
      </div>`).join('')}
      ${(teamData.members||[]).length<4?`<div style="border:1px dashed rgba(255,255,255,.1);border-radius:8px;padding:16px;text-align:center;margin-top:12px;cursor:none" onclick="navigator.clipboard.writeText('${teamData.invite_code}').then(()=>showToast('Invite code copied!','success'))"><div style="font-size:9px;letter-spacing:3px;color:var(--mu)">OPEN SLOT — SHARE INVITE CODE</div></div>`:''}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap" class="reveal">
      <button class="btn btn-danger" onclick="leaveTeam()">LEAVE TEAM</button>
    </div>
  </div></div>`;
}

/* ══ PROFILE ══════════════════════════════════════════════ */
async function buildProfile(){
  const u=S.user;
  let profile={user:u,history:[],achievements:[]};
  try { profile=await API.get('/profile/'+u.username); } catch{}
  return`<div class="page-wrap"><div class="container" style="padding-top:36px">
    <div style="display:flex;gap:28px;align-items:flex-start;margin-bottom:28px;flex-wrap:wrap">
      <div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,var(--c),var(--v),var(--p));display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:900;flex-shrink:0">${u.username.charAt(0).toUpperCase()}</div>
      <div style="flex:1"><h1 class="title-xl">${u.username.toUpperCase()}</h1><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"><span class="chip" style="color:var(--c);border-color:var(--c)">${u.role.toUpperCase()}</span></div>${profile.user.bio?`<p style="font-family:var(--mono);font-size:12px;color:var(--si);margin-top:10px;line-height:1.7">${profile.user.bio}</p>`:''}</div>
    </div>
    <div class="grid-2">
      <div class="card reveal">
        <div class="title-sm" style="margin-bottom:18px">EVENT HISTORY</div>
        ${profile.history.length?profile.history.map(h=>`
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="flex:1"><div style="font-size:12px;font-weight:700">${h.name}</div><div style="font-family:var(--mono);font-size:10px;color:var(--mu)">Rank #${h.rank} · ${h.score} pts</div></div>
          <span class="badge ${h.status==='live'?'badge-live':'badge-past'}">${h.status==='live'?'LIVE':'DONE'}</span>
        </div>`).join(''):`<div style="font-family:var(--mono);font-size:12px;color:var(--si);padding:20px 0">No event history yet. <a href="#/events" style="color:var(--c)">Join an event →</a></div>`}
      </div>
      <div class="card reveal">
        <div class="title-sm" style="margin-bottom:16px">ACHIEVEMENTS (${profile.achievements.length})</div>
        ${profile.achievements.length?`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${profile.achievements.map(a=>`<div style="text-align:center;padding:10px;background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.1);border-radius:8px" title="${a.name}: ${a.description}"><div style="font-size:22px">${a.icon}</div></div>`).join('')}</div>`:`<div style="font-family:var(--mono);font-size:12px;color:var(--si)">Solve challenges to earn achievements.</div>`}
      </div>
    </div>
  </div></div>`;
}

/* ══ ORGANIZER ════════════════════════════════════════════ */
async function buildOrganize(){
  const tabs={overview:'OVERVIEW',events:'EVENTS',challenges:'CHALLENGES',anticheat:'INTEGRITY',analytics:'ANALYTICS',settings:'SETTINGS'};
  return`<div class="page-wrap" style="padding-top:60px"><div class="org-layout">
    <div class="org-sidebar">
      <div style="padding:20px 24px 20px"><div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-bottom:6px">ORGANIZER</div><div style="font-size:14px;font-weight:700">${S.user.username.toUpperCase()}</div></div>
      ${Object.entries(tabs).map(([k,v])=>`<div class="org-nav-item ${S.orgTab===k?'active':''}" onclick="setOrgTab('${k}')"><span class="org-icon">${{overview:'📊',events:'⚡',challenges:'🎯',anticheat:'🛡️',analytics:'📈',settings:'⚙️'}[k]}</span><span>${v}</span></div>`).join('')}
      <div style="padding:20px 24px"><a href="#/organize/create"><button class="btn btn-primary" style="width:100%;justify-content:center">+ NEW EVENT</button></a></div>
    </div>
    <div class="org-main" id="org-main">${await orgTabContent()}</div>
  </div></div>`;
}

async function orgTabContent(){
  if(S.orgTab==='overview'){
    let events=[]; try{const r=await API.get('/organizer/events');events=r.events||[];}catch{}
    const live=events.find(e=>e.status==='live');
    return`<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><h2 class="title-lg">Platform Overview</h2></div>
      <div class="stat-cards">
        ${[['⚡',events.filter(e=>e.status==='live').length,'LIVE EVENTS',''],['📋',events.length,'MY EVENTS','total'],['👥',events.reduce((a,e)=>a+(e.team_count||0),0),'TOTAL TEAMS','across events'],['🎯',events.length,'EVENTS CREATED','']].map(([ic,v,l,t])=>`<div class="stat-card"><div style="font-size:22px;margin-bottom:8px">${ic}</div><div class="sc-val">${v}</div><div class="sc-lbl">${l}</div><div class="sc-trend">${t}</div></div>`).join('')}
      </div>
      ${live?`<div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div class="title-sm">ACTIVE EVENT</div><span class="badge badge-live"><span class="dot-live"></span>LIVE</span></div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">${live.name}</div>
        ${[['Teams',live.team_count||0],['Max',live.max_teams||500]].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-family:var(--mono);font-size:11px;color:var(--si)">${l}</span><span style="font-family:var(--mono);font-size:11px">${v}</span></div>`).join('')}
        <div style="display:flex;gap:10px;margin-top:14px"><a href="#/organize/${live.id}/challenges" style="flex:1"><button class="btn btn-primary" style="width:100%;justify-content:center">MANAGE</button></a><a href="#/organize/${live.id}/anticheat" style="flex:1"><button class="btn btn-danger" style="width:100%;justify-content:center">🛡️ INTEGRITY</button></a></div>
      </div>`:'' }
      <div class="card">
        <div class="title-sm" style="margin-bottom:14px">MY EVENTS</div>
        ${events.length?`<table class="data-table"><thead><tr><th>NAME</th><th>STATUS</th><th>TEAMS</th><th>ACTIONS</th></tr></thead><tbody>
          ${events.map(e=>`<tr>
            <td style="font-weight:700">${e.name}</td>
            <td><span class="badge ${e.status==='live'?'badge-live':e.status==='published'?'badge-upcoming':'badge-past'}">${e.status.toUpperCase()}</span></td>
            <td style="color:var(--c)">${e.team_count||0}</td>
            <td style="display:flex;gap:6px">
              <a href="#/organize/${e.id}/challenges"><button class="btn btn-sm btn-ghost">CHALLENGES</button></a>
              <a href="#/organize/${e.id}/anticheat"><button class="btn btn-sm btn-danger">INTEGRITY</button></a>
            </td>
          </tr>`).join('')}
        </tbody></table>`:`<div style="font-family:var(--mono);font-size:12px;color:var(--si);padding:20px 0">No events yet. <a href="#/organize/create" style="color:var(--c)">Create one →</a></div>`}
      </div>
    </div>`;
  }
  if(S.orgTab==='anticheat'){
    let events=[]; try{const r=await API.get('/organizer/events');events=r.events||[];}catch{}
    const live=events.find(e=>e.status==='live');
    if(!live) return`<div class="card"><div class="title-sm" style="margin-bottom:10px">🛡️ INTEGRITY SHIELD</div><p style="font-family:var(--mono);font-size:12px;color:var(--si)">No live event. Start an event to see anti-cheat data.</p></div>`;
    let data={alerts:[],submissions:[]}; try{data=await API.get('/organizer/events/'+live.id+'/anticheat');}catch{}
    return`<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><h2 class="title-lg">🛡️ INTEGRITY SHIELD</h2><span class="badge badge-live"><span class="dot-live"></span>MONITORING</span></div>
      <div class="stat-cards" style="margin-bottom:22px">
        ${[['🚨',data.alerts.filter(a=>!a.resolved&&a.severity==='critical').length,'CRITICAL'],['⚠️',data.alerts.filter(a=>!a.resolved&&a.severity==='warning').length,'WARNINGS'],['👁️',data.submissions.length,'SUBMISSIONS'],['✅',data.submissions.filter(s=>s.is_correct).length,'CORRECT']].map(([ic,v,l])=>`<div class="stat-card"><div style="font-size:22px;margin-bottom:8px">${ic}</div><div class="sc-val">${v}</div><div class="sc-lbl">${l}</div></div>`).join('')}
      </div>
      ${data.alerts.length?`<div class="card" style="margin-bottom:18px"><div class="title-sm" style="margin-bottom:14px">ACTIVE ALERTS</div>
        ${data.alerts.filter(a=>!a.resolved).map(a=>`<div class="ac-alert ${a.severity==='critical'?'critical':''}">
          <span class="ac-badge ${a.severity==='critical'?'crit':'warn'}">${a.severity.toUpperCase()}</span>
          <div><div class="ac-text"><strong>${a.team_name||'Unknown'}:</strong> ${a.type.replace(/_/g,' ')} — ${JSON.stringify(a.details)}</div>
          <div style="font-size:9px;color:var(--mu);margin-top:4px">${new Date(a.created_at).toLocaleTimeString()} · <span style="color:var(--or);cursor:none" onclick="resolveAlert('${a.id}')">RESOLVE</span></div></div>
        </div>`).join('')}
      </div>`:''}
      <div class="card">
        <div class="title-sm" style="margin-bottom:14px">SUBMISSION LOG</div>
        <table class="data-table"><thead><tr><th>TEAM</th><th>CHALLENGE</th><th>TIME</th><th>IP</th><th>STATUS</th></tr></thead><tbody>
          ${data.submissions.slice(0,50).map(s=>`<tr>
            <td style="font-weight:700">${s.team_name}</td>
            <td style="color:var(--v)">${s.challenge_name}</td>
            <td style="color:var(--mu)">${new Date(s.submitted_at).toLocaleTimeString()}</td>
            <td style="color:var(--mu)">${s.ip_address}</td>
            <td>${s.is_correct?'<span style="color:var(--li)">✅ CORRECT</span>':'<span style="color:var(--re)">✗ WRONG</span>'}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
  }
  if(S.orgTab==='analytics'){
    let events=[]; try{const r=await API.get('/organizer/events');events=r.events||[];}catch{}
    const live=events.find(e=>e.status==='live');
    if(!live) return`<div class="card"><div class="title-sm">ANALYTICS</div><p style="font-family:var(--mono);font-size:12px;color:var(--si);margin-top:10px">No live event.</p></div>`;
    let analytics={stats:{},by_category:[]}; try{analytics=await API.get('/organizer/events/'+live.id+'/analytics');}catch{}
    const s=analytics.stats||{};
    return`<div><h2 class="title-lg" style="margin-bottom:24px">Analytics — ${live.name}</h2>
      <div class="stat-cards" style="margin-bottom:22px">
        ${[['👥',s.total_teams||0,'TEAMS'],['📨',s.total_submissions||0,'SUBMISSIONS'],['✅',s.correct_submissions||0,'CORRECT'],['🚨',s.active_alerts||0,'ALERTS']].map(([ic,v,l])=>`<div class="stat-card"><div style="font-size:22px;margin-bottom:8px">${ic}</div><div class="sc-val">${v}</div><div class="sc-lbl">${l}</div></div>`).join('')}
      </div>
      <div class="card"><div class="title-sm" style="margin-bottom:14px">SOLVES BY CATEGORY</div>
        ${(analytics.by_category||[]).map(c=>`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:9px;letter-spacing:2px;color:var(--cat-${c.category})">${c.category.toUpperCase()}</span><span style="font-family:var(--mono);font-size:10px;color:var(--mu)">${c.solves} solves / ${c.total} challenges</span></div><div class="progress-bar"><div class="progress-fill" style="width:${c.total>0?Math.round(c.solves/c.total*100):0}%;background:var(--cat-${c.category})"></div></div></div>`).join('')}
      </div>
    </div>`;
  }
  return`<div class="card"><div class="title-sm" style="margin-bottom:10px">COMING SOON</div><p style="font-family:var(--mono);font-size:12px;color:var(--si)">This section is in development.</p></div>`;
}

/* ══ CHALLENGE MANAGER ════════════════════════════════════ */
async function buildChallengeManager(eventId){
  let challenges=[], event=null;
  try { const r=await API.get('/organizer/events/'+eventId+'/challenges'); challenges=r.challenges||[]; } catch{}
  try { const r=await API.get('/events'); event=r.events?.find(e=>e.id===eventId); } catch{}
  return`<div class="page-wrap"><div class="org-layout" style="height:calc(100vh - 60px)">
    <div class="org-sidebar"><div style="padding:20px 24px"><div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-bottom:6px">CHALLENGE MGR</div><div style="font-size:13px;font-weight:700">${event?.name||eventId}</div></div>
      ${['All Challenges','+ Add Challenge'].map((item,i)=>`<div class="org-nav-item ${i===0?'active':''}" onclick="${i===1?'toggleAddForm()':''}">${item}</div>`).join('')}
    </div>
    <div class="org-main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:12px"><h2 class="title-lg">Challenges (${challenges.length})</h2><button class="btn btn-primary" onclick="toggleAddForm()">+ ADD CHALLENGE</button></div>
      <div class="card" style="margin-bottom:20px;display:none;border-color:rgba(0,245,255,.15)" id="add-ch-form">
        <div class="title-sm" style="margin-bottom:18px;color:var(--c)">NEW CHALLENGE</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          <div class="form-group"><label class="form-label">NAME</label><input class="form-input" id="ch-name" placeholder="BUFFER_OVERFLOW_101"></div>
          <div class="form-group"><label class="form-label">CATEGORY</label><select class="form-select" id="ch-cat">${['web','pwn','crypto','re','osint','dfir','stego','misc'].map(c=>`<option value="${c}">${c.toUpperCase()}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">POINTS</label><input class="form-input" type="number" id="ch-pts" placeholder="500" min="50" max="2000"></div>
          <div class="form-group"><label class="form-label">DIFFICULTY (1-5)</label><input class="form-input" type="number" id="ch-diff" min="1" max="5" placeholder="3"></div>
        </div>
        <div class="form-group" style="margin-bottom:14px"><label class="form-label">DESCRIPTION</label><textarea class="form-textarea" id="ch-desc" placeholder="Describe the challenge..."></textarea></div>
        <div class="form-group" style="margin-bottom:14px"><label class="form-label">BASE FLAG <span style="color:var(--mu);font-size:7px">— TEAM DERIVATIVES AUTO-GENERATED</span></label><input class="form-input" id="ch-flag" placeholder="ARQADEX{...}"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" onclick="saveChallenge('${eventId}')">SAVE CHALLENGE</button>
          <button class="btn btn-ghost" onclick="toggleAddForm()">CANCEL</button>
          <label style="display:flex;align-items:center;gap:8px;cursor:none;font-family:var(--mono);font-size:10px;color:var(--or);margin-left:auto"><input type="checkbox" id="ch-honeypot" style="accent-color:var(--or)"> Honeypot (trap)</label>
        </div>
        <div id="ch-save-msg" style="margin-top:10px"></div>
      </div>
      <div class="card"><table class="data-table"><thead><tr><th>CHALLENGE</th><th>CAT</th><th>PTS</th><th>SOLVES</th><th>DIFF</th><th>ACTIONS</th></tr></thead><tbody>
        ${challenges.map(c=>`<tr>
          <td style="font-weight:700">${c.name}</td>
          <td><span class="chip" style="color:var(--cat-${c.category});border-color:var(--cat-${c.category})">${c.category.toUpperCase()}</span></td>
          <td style="color:var(--li);font-weight:700">${c.points}</td>
          <td style="color:var(--c)">${c.solve_count}</td>
          <td>${Array.from({length:5},(_,i)=>`<span style="color:${i<c.difficulty?'var(--or)':'var(--mu)'}">★</span>`).join('')}</td>
          <td style="display:flex;gap:6px">
            <button class="btn btn-sm btn-danger" onclick="deleteChallenge('${c.id}')">DELETE</button>
            <button class="btn btn-sm btn-ghost" onclick="toggleChallenge('${c.id}',${c.is_visible})">${c.is_visible?'HIDE':'SHOW'}</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>
  </div></div>`;
}

async function buildAntiCheat(eventId){
  S.orgTab='anticheat';
  return`<div class="page-wrap"><div class="container" style="padding-top:36px"><div style="margin-bottom:28px"><div class="eyebrow">INTEGRITY SYSTEM</div><h1 class="title-xl">🛡️ INTEGRITY SHIELD</h1></div><div id="ac-content">${await orgTabContent()}</div></div></div>`;
}

function viewCreateEvent(){ return`<div class="page-wrap"><div class="container" style="padding-top:36px;max-width:820px">
  <div style="margin-bottom:28px"><div class="eyebrow">NEW OPERATION</div><h1 class="title-xl">Create CTF Event</h1></div>
  <div class="card" style="border-color:rgba(0,245,255,.15)"><div style="display:grid;gap:18px">
    <div class="form-group"><label class="form-label">EVENT NAME</label><input class="form-input" id="ev-name" placeholder="ARQADEX PRIME 2026"></div>
    <div class="form-group"><label class="form-label">URL SLUG <span style="color:var(--mu);font-size:7px">— used in URL: ctf.arqadex.site/event/slug</span></label><input class="form-input" id="ev-slug" placeholder="arqadex-prime-2026"></div>
    <div class="grid-2"><div class="form-group"><label class="form-label">START (UTC)</label><input class="form-input" type="datetime-local" id="ev-start"></div><div class="form-group"><label class="form-label">END (UTC)</label><input class="form-input" type="datetime-local" id="ev-end"></div></div>
    <div class="form-group"><label class="form-label">DESCRIPTION</label><textarea class="form-textarea" id="ev-desc" placeholder="Describe your CTF event..."></textarea></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">MAX TEAMS</label><input class="form-input" type="number" id="ev-maxteams" placeholder="500"></div>
      <div class="form-group"><label class="form-label">TEAM SIZE</label><input class="form-input" type="number" id="ev-teamsize" placeholder="4"></div>
    </div>
    <div class="form-group"><label class="form-label">CATEGORIES (comma-separated)</label><input class="form-input" id="ev-cats" placeholder="web,pwn,crypto,re,osint,dfir,stego,misc"></div>
    <div class="form-group"><label class="form-label">PRIZES (comma-separated)</label><input class="form-input" id="ev-prizes" placeholder="$5,000,$2,500,$1,000"></div>
    <div><div style="font-size:9px;letter-spacing:3px;color:var(--mu);margin-bottom:10px">INTEGRITY OPTIONS</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${[['Per-team flag derivatives','ev-pertf',true],['IP clustering detection','ev-ipclust',true],['Rate limiting (10/min)','ev-ratelim',true],['Honeypot challenges','ev-honey',false]].map(([l,id,def])=>`<label style="display:flex;align-items:center;gap:10px;cursor:none;font-family:var(--mono);font-size:11px;color:var(--si)"><input type="checkbox" id="${id}" ${def?'checked':''} style="accent-color:var(--c)">${l}</label>`).join('')}
      </div>
    </div>
    <div id="ev-create-msg"></div>
    <div style="display:flex;gap:12px"><button class="btn btn-primary btn-lg" onclick="submitCreateEvent()">CREATE EVENT</button><button class="btn btn-ghost btn-lg" onclick="navigate('/organize')">CANCEL</button></div>
  </div></div>
</div></div>`; }

function view404(){ return`<div class="page-wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><div style="font-size:80px;font-weight:900;color:rgba(255,255,255,.05);-webkit-text-stroke:2px rgba(0,245,255,.18);margin-bottom:20px">404</div><div class="title-xl" style="margin-bottom:14px">TARGET NOT FOUND</div><p style="font-family:var(--mono);font-size:13px;color:var(--si);margin-bottom:28px">The requested endpoint does not exist.</p><a href="#/"><button class="btn btn-primary">RETURN HOME</button></a></div></div>`; }

/* ══ CHALLENGE MODAL ══════════════════════════════════════ */
let CURRENT_CHALLENGES = [];

window.openChallenge = async function(id){
  const c = CURRENT_CHALLENGES.find(x=>x.id===id);
  if(!c) return;
  const solved = S.solved.has(id)||c.solved;
  document.getElementById('modal-root').classList.add('active');
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="--top-color:var(--cat-${c.category})">
      <button class="modal-close" onclick="closeModal()">✕ CLOSE</button>
      <div class="modal-hdr">
        <span class="chip" style="color:var(--cat-${c.category});border-color:var(--cat-${c.category});margin-bottom:10px">${c.category.toUpperCase()}</span>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
          <div><h2 class="title-lg" style="color:var(--cat-${c.category})">${c.name}</h2>
          <div style="display:flex;align-items:center;gap:14px;margin-top:8px">
            <span style="font-size:26px;font-weight:900;color:var(--c);font-family:var(--mono)">${c.points} <span style="font-size:12px;color:var(--mu);font-weight:400">pts</span></span>
            <div class="ch-diff" style="margin:0">${Array.from({length:5},(_,i)=>`<div class="ch-diff-pip ${i<c.difficulty?'filled':''}" style="width:18px;height:4px"></div>`).join('')}</div>
            <span style="font-family:var(--mono);font-size:11px;color:var(--mu)">${c.solve_count} solves</span>
          </div></div>
          ${solved?`<span class="badge" style="color:var(--li);border-color:var(--li);background:rgba(199,255,77,.07);flex-shrink:0">✓ SOLVED</span>`:''}
        </div>
      </div>
      <div class="modal-body">
        <div style="font-family:var(--mono);font-size:13px;color:rgba(255,255,255,.62);line-height:1.85;margin-bottom:22px">${c.description}</div>
        ${(c.files||[]).length?`<div style="margin-bottom:22px"><div style="font-size:8px;letter-spacing:4px;color:var(--mu);margin-bottom:9px">FILES</div><div style="display:flex;flex-wrap:wrap;gap:8px">${c.files.map(f=>`<a href="${f.url}" target="_blank" style="font-family:var(--mono);font-size:11px;color:var(--c);background:rgba(0,245,255,.06);border:1px solid rgba(0,245,255,.15);border-radius:6px;padding:7px 13px;cursor:pointer">📎 ${f.name}</a>`).join('')}</div></div>`:''}
        ${(c.hints||[]).length?`<div style="margin-bottom:22px"><div style="font-size:8px;letter-spacing:4px;color:var(--mu);margin-bottom:9px">HINTS <span style="color:var(--or)">(deducts points)</span></div>${c.hints.map((h,i)=>`<div class="hint-item"><div class="hint-hdr" onclick="useHint('${c.id}','${h.id}','${h.cost}',this)"><span style="font-size:10px;letter-spacing:2px;color:var(--si)">HINT ${i+1}</span><span style="font-family:var(--mono);font-size:9px;color:var(--or)">-${h.cost} pts · click to reveal</span></div><div class="hint-body" id="hint-body-${h.id}">${h.text||''}</div></div>`).join('')}</div>`:''}
        ${!solved?`<div><div style="font-size:8px;letter-spacing:4px;color:var(--mu);margin-bottom:9px">SUBMIT FLAG</div>
          <div class="flag-wrap"><input type="text" class="flag-inp" id="fi-${id}" placeholder="ARQADEX{...}" spellcheck="false" autocomplete="off" onkeydown="if(event.key==='Enter')submitFlag('${id}')"><button class="btn btn-primary" id="fsub-${id}" onclick="submitFlag('${id}')">SUBMIT</button></div>
          <div id="fr-${id}"></div></div>`:`<div style="padding:14px;background:rgba(199,255,77,.06);border:1px solid rgba(199,255,77,.2);border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--li);letter-spacing:2px">✓ SOLVED — +${c.points} POINTS AWARDED</div>`}
      </div>
    </div>
  </div>`;
  setTimeout(()=>document.getElementById(`fi-${id}`)?.focus(),100);
};

window.closeModal = function(){ const m=document.getElementById('modal-root');m.classList.remove('active');m.innerHTML=''; };
document.addEventListener('keydown',e=>{ if(e.key==='Escape')window.closeModal(); });

window.submitFlag = async function(id){
  const inp=document.getElementById(`fi-${id}`);
  const res=document.getElementById(`fr-${id}`);
  const btn=document.getElementById(`fsub-${id}`);
  if(!inp||!res) return;
  const flag=inp.value.trim();
  if(!flag) return;
  btn.disabled=true; btn.textContent='CHECKING...';
  try {
    const data=await API.post('/challenges/'+id+'/submit',{flag});
    if(data.correct){
      res.innerHTML=`<div class="flag-result flag-ok" style="margin-top:10px">✓ CORRECT FLAG — +${data.points} PTS${data.firstBlood?' — 🩸 FIRST BLOOD!':''}</div>`;
      S.markSolved(id);
      showAchievement('⚡','CHALLENGE SOLVED','');
      const ch=CURRENT_CHALLENGES.find(x=>x.id===id);
      if(ch){ch.solved=true;ch.solve_count++;}
      // Update score display
      setTimeout(()=>{ closeModal(); render(); },1800);
    } else {
      res.innerHTML=`<div class="flag-result flag-bad" style="margin-top:10px">✗ INCORRECT FLAG${data.remaining!==null?' — '+data.remaining+' attempts left':''}</div>`;
      inp.style.borderColor='var(--re)'; setTimeout(()=>inp.style.borderColor='',800);
    }
  } catch(err){
    res.innerHTML=`<div class="flag-result flag-bad" style="margin-top:10px">✗ ${err.message}</div>`;
  }
  btn.disabled=false; btn.textContent='SUBMIT';
};

window.useHint = async function(challengeId, hintId, cost, headerEl){
  const body=document.getElementById('hint-body-'+hintId);
  if(body.classList.contains('open')){ body.classList.remove('open'); return; }
  if(body.textContent.trim()) { body.classList.add('open'); return; }
  try {
    const data=await API.post('/challenges/'+challengeId+'/hints/'+hintId,{});
    body.textContent=data.hint;
    body.classList.add('open');
    headerEl.querySelector('span:last-child').textContent=data.already_used?'(already used)':'(-'+cost+' pts used)';
  } catch(err){ showToast(err.message,'error'); }
};

/* ══ TIMERS ═══════════════════════════════════════════════ */
const timers={};
function startTimer(id, endTime){
  if(timers[id])clearInterval(timers[id]);
  function upd(){
    const el=document.getElementById(id);if(!el){clearInterval(timers[id]);return;}
    const diff=Math.max(0,Math.floor((new Date(endTime)-Date.now())/1000));
    const h=Math.floor(diff/3600),m=Math.floor((diff%3600)/60),s=diff%60;
    el.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.className=el.className.replace(/\bwarning\b|\bdanger\b/g,'');
    if(diff<3600)el.classList.add('warning');
    if(diff<600)el.classList.add('danger');
  }
  upd();timers[id]=setInterval(upd,1000);
}

async function initLanding(){
  if(!CACHE.events)CACHE.events=(await API.get('/events').catch(()=>({events:[]}))).events||[];
  const live=CACHE.events.find(e=>e.status==='live');
  if(live?.end_time)startTimer('hero-timer',live.end_time);
  initReveal();
}
async function initEventDetail(){
  const slug=getRoute().split('/')[2];
  try { const {event:e}=await API.get('/events/'+slug); if(e?.end_time&&e?.status==='live')startTimer('event-timer',e.end_time); } catch{}
  initReveal();
}
async function initCompete(slug){
  try {
    const {event:e}=await API.get('/events/'+slug);
    if(e?.end_time)startTimer('compete-timer',e.end_time);
    if(e?.end_time)startTimer('sidebar-timer',e.end_time);
    // Cache challenges for modal
    const {challenges=[]}=await API.get('/events/'+slug+'/challenges').catch(()=>({challenges:[]}));
    CURRENT_CHALLENGES=challenges;
  } catch{}
  connectSocket(slug);
  startLiveFeed();
  window.filterChallenges=cat=>{
    document.querySelectorAll('.cat-tab').forEach(t=>t.classList.toggle('active',t.dataset.cat===cat));
    document.querySelectorAll('.ch-card').forEach(c=>{c.style.display=(cat==='all'||c.dataset.cat===cat)?'':'none';});
  };
}
async function initScoreboard(){
  const slug=getRoute().split('/')[2];
  try { const {event:e}=await API.get('/events/'+slug); if(e?.end_time&&e?.status==='live')startTimer('sb-timer',e.end_time); } catch{}
  connectSocket(slug);
}
function initOrganize(){ startLiveFeed(); }
function initReveal(){
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});},{threshold:.08,rootMargin:'0px 0px -30px 0px'});
  document.querySelectorAll('.reveal:not(.visible)').forEach(el=>obs.observe(el));
}
function initAuth(){ window.selectRole=r=>document.querySelectorAll('.role-card').forEach(c=>c.classList.toggle('selected',c.dataset.role===r)); }
function initChallengeManager(){ window.toggleAddForm=()=>{const f=document.getElementById('add-ch-form');if(f)f.style.display=f.style.display==='none'?'block':'none';}; }

/* ══ LIVE FEED ════════════════════════════════════════════ */
const FEED_TPLS=[
  d=>`<span style="color:var(--p);font-weight:700">🩸 FIRST BLOOD</span> Team <span style="color:var(--c);font-weight:700">${d.team}</span> solved <span style="color:var(--v)">${d.challenge}</span>`,
  d=>`Team <span style="color:var(--c);font-weight:700">${d.team}</span> solved <span style="color:var(--v)">${d.challenge}</span> <span style="color:var(--li)">+${d.points}pts</span>`,
];
function addLiveFeedItem(data){
  const feed=document.getElementById('live-feed');if(!feed)return;
  const div=document.createElement('div');div.className='notif-item';
  div.innerHTML=(data.isFirstBlood?FEED_TPLS[0]:FEED_TPLS[1])(data);
  feed.insertBefore(div,feed.firstChild);
  while(feed.children.length>8)feed.removeChild(feed.lastChild);
}
const DEMO_TEAMS=['0xGHOST','PHANTOM_LAB','NULL_PTR','SHELLCODE_FC','CRYPTONITES'];
const DEMO_CHALLS=['JWT_NIGHTMARE','ORACLE_WHISPERS','STACK_PHANTOM','BINARY_PHANTOM','FREQUENCY_GHOST'];
function startLiveFeed(){
  const add=()=>{
    addLiveFeedItem({team:DEMO_TEAMS[Math.floor(Math.random()*DEMO_TEAMS.length)],challenge:DEMO_CHALLS[Math.floor(Math.random()*DEMO_CHALLS.length)],points:[250,350,400,500][Math.floor(Math.random()*4)],isFirstBlood:Math.random()>.85});
  };
  add();add();
  setInterval(add,5000+Math.random()*4000);
}
function updateLiveScoreboard(scoreboard){
  const el=document.getElementById('sb-mini');
  if(!el)return;
  el.innerHTML=scoreboard.slice(0,8).map((t,i)=>`
    <div style="display:flex;align-items:center;gap:7px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.04)">
      <span style="font-size:10px;color:${i<3?['#FFD700','#C0C0C0','#CD7F32'][i]:'var(--mu)'};min-width:16px;font-weight:700">#${i+1}</span>
      <div class="sb-avatar" style="width:20px;height:20px;font-size:8px;background:rgba(0,245,255,.15);color:var(--c)">${t.name.charAt(0)}</div>
      <span style="flex:1;font-size:10px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--c)">${t.score}</span>
    </div>`).join('');
  // Update my score
  const myTeam=scoreboard.find(t=>S.user&&t.members?.includes(S.user.username));
  if(myTeam){
    ['live-score','tsd-score'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=myTeam.score;});
    const rk=document.getElementById('live-rank');if(rk)rk.textContent='#'+myTeam.rank;
    const tsdRk=document.querySelector('.tsd-rank');if(tsdRk)tsdRk.textContent='RANK #'+myTeam.rank;
  }
}

/* ══ ORG TAB SWITCHING ════════════════════════════════════ */
window.setOrgTab = async tab=>{
  S.orgTab=tab;
  const m=document.getElementById('org-main');
  if(m){ m.innerHTML=pageLoad('Loading...'); m.innerHTML=await orgTabContent(); }
  document.querySelectorAll('.org-nav-item').forEach((item,i)=>{
    item.classList.toggle('active',Object.keys({overview:1,events:1,challenges:1,anticheat:1,analytics:1,settings:1})[i]===tab);
  });
};

/* ══ AUTH HANDLERS ════════════════════════════════════════ */
window.handleAuth = async(e,mode)=>{
  e.preventDefault();
  const errEl=document.getElementById('auth-error');
  const btn=document.getElementById('auth-submit');
  btn.disabled=true; btn.textContent='PROCESSING...';
  errEl.style.display='none';
  try {
    const role=document.querySelector('.role-card.selected')?.dataset.role||'participant';
    const email=document.getElementById('inp-email').value.trim();
    const password=document.getElementById('inp-password').value;
    let data;
    if(mode==='register'){
      const username=document.getElementById('inp-username').value.trim();
      data=await API.post('/auth/register',{username,email,password,role});
    } else {
      data=await API.post('/auth/login',{email,password});
    }
    S.token=data.token;
    S.user=data.user;
    CACHE.events=null;
    showToast('Welcome, '+data.user.username.toUpperCase()+'!','success');
    setTimeout(()=>navigate(data.user.role!=='participant'?'/organize':'/dashboard'),600);
  } catch(err){
    errEl.textContent=err.message;
    errEl.style.display='block';
    btn.disabled=false;
    btn.textContent=mode==='login'?'ACCESS ARENA':'CREATE OPERATIVE';
  }
};

window.logout=()=>{ S.token=null; S.user=null; CACHE.events=null; navigate('/'); };

/* ══ TEAM HANDLERS ════════════════════════════════════════ */
window.showCreateTeam=()=>{
  document.getElementById('modal-root').classList.add('active');
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:420px">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-hdr"><div class="title-sm">CREATE TEAM</div></div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:16px"><label class="form-label">TEAM NAME</label><input class="form-input" id="tm-name" placeholder="0xGHOST" maxlength="30"></div>
        <div id="tm-create-err" style="display:none;color:var(--re);font-family:var(--mono);font-size:11px;margin-bottom:12px"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="createTeam()">CREATE TEAM</button>
      </div>
    </div>
  </div>`;
};

window.showJoinTeam=()=>{
  document.getElementById('modal-root').classList.add('active');
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:420px">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-hdr"><div class="title-sm">JOIN TEAM</div></div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:16px"><label class="form-label">INVITE CODE</label><input class="form-input" id="tm-code" placeholder="Enter invite code..."></div>
        <div id="tm-join-err" style="display:none;color:var(--re);font-family:var(--mono);font-size:11px;margin-bottom:12px"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="joinTeam()">JOIN TEAM</button>
      </div>
    </div>
  </div>`;
};

window.createTeam=async()=>{
  const name=document.getElementById('tm-name')?.value.trim();
  if(!name) return;
  const err=document.getElementById('tm-create-err');
  try {
    await API.post('/teams',{name});
    showToast('Team "'+name+'" created!','success');
    closeModal(); CACHE.events=null; render();
  } catch(e){ if(err){err.textContent=e.message;err.style.display='block';} }
};

window.joinTeam=async()=>{
  const code=document.getElementById('tm-code')?.value.trim();
  if(!code) return;
  const err=document.getElementById('tm-join-err');
  try {
    const data=await API.post('/teams/join',{invite_code:code});
    showToast('Joined team "'+data.team.name+'"!','success');
    closeModal(); CACHE.events=null; render();
  } catch(e){ if(err){err.textContent=e.message;err.style.display='block';} }
};

window.leaveTeam=async()=>{
  if(!confirm('Leave your team? This cannot be undone.')) return;
  try { await API.del('/teams/leave'); showToast('Left team','success'); render(); } catch(err){ showToast(err.message,'error'); }
};

window.registerForEvent=async(slug)=>{
  const btn=document.getElementById('reg-btn');
  const msg=document.getElementById('reg-msg');
  if(btn) btn.disabled=true;
  try {
    await API.post('/events/'+slug+'/register',{});
    if(msg) msg.innerHTML=`<div style="font-family:var(--mono);font-size:11px;color:var(--li)">✓ Team registered! <a href="#/compete/${slug}" style="color:var(--c)">Enter competition →</a></div>`;
    CACHE.events=null;
  } catch(err){ if(msg) msg.innerHTML=`<div style="font-family:var(--mono);font-size:11px;color:var(--re)">${err.message}</div>`; if(btn) btn.disabled=false; }
};

/* ══ ORGANIZER HANDLERS ═══════════════════════════════════ */
window.submitCreateEvent=async()=>{
  const msg=document.getElementById('ev-create-msg');
  try {
    const name=document.getElementById('ev-name')?.value.trim();
    const slug=document.getElementById('ev-slug')?.value.trim();
    const cats=(document.getElementById('ev-cats')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    const prizes=(document.getElementById('ev-prizes')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!name||!slug){showToast('Name and slug required','error');return;}
    const data=await API.post('/organizer/events',{
      name,slug,
      description:document.getElementById('ev-desc')?.value||'',
      start_time:document.getElementById('ev-start')?.value||null,
      end_time:document.getElementById('ev-end')?.value||null,
      max_teams:parseInt(document.getElementById('ev-maxteams')?.value)||500,
      team_size:parseInt(document.getElementById('ev-teamsize')?.value)||4,
      categories:cats,prizes,
      settings:{per_team_flags:document.getElementById('ev-pertf')?.checked,
        ip_cluster_detection:document.getElementById('ev-ipclust')?.checked,
        honeypot_enabled:document.getElementById('ev-honey')?.checked}
    });
    showToast('Event created!','success');
    CACHE.events=null;
    setTimeout(()=>navigate('/organize/'+data.event.id+'/challenges'),800);
  } catch(err){ if(msg) msg.innerHTML=`<div style="color:var(--re);font-family:var(--mono);font-size:11px">${err.message}</div>`; }
};

window.saveChallenge=async(eventId)=>{
  const msg=document.getElementById('ch-save-msg');
  try {
    const name=document.getElementById('ch-name')?.value.trim();
    const base_flag=document.getElementById('ch-flag')?.value.trim();
    if(!name||!base_flag){showToast('Name and flag required','error');return;}
    await API.post('/organizer/challenges',{
      event_id:eventId,name,
      category:document.getElementById('ch-cat')?.value||'misc',
      description:document.getElementById('ch-desc')?.value||'',
      points:parseInt(document.getElementById('ch-pts')?.value)||500,
      difficulty:parseInt(document.getElementById('ch-diff')?.value)||3,
      base_flag,is_honeypot:document.getElementById('ch-honeypot')?.checked||false,
    });
    showToast('Challenge saved!','success');
    if(msg) msg.innerHTML=`<div style="color:var(--li);font-family:var(--mono);font-size:11px">✓ Saved</div>`;
    setTimeout(()=>render(),800);
  } catch(err){ if(msg) msg.innerHTML=`<div style="color:var(--re);font-family:var(--mono);font-size:11px">${err.message}</div>`; }
};

window.deleteChallenge=async(id)=>{
  if(!confirm('Delete challenge? This cannot be undone.'))return;
  try { await API.del('/organizer/challenges/'+id); showToast('Deleted','success'); render(); } catch(err){ showToast(err.message,'error'); }
};

window.toggleChallenge=async(id,isVisible)=>{
  try { await API.put('/organizer/challenges/'+id,{is_visible:!isVisible}); showToast(isVisible?'Hidden':'Visible','success'); render(); } catch(err){ showToast(err.message,'error'); }
};

window.resolveAlert=async(id)=>{
  try { await API.put('/organizer/alerts/'+id+'/resolve',{}); showToast('Alert resolved','success'); setOrgTab('anticheat'); } catch(err){ showToast(err.message,'error'); }
};

window.openNotifications=()=>{
  document.getElementById('modal-root').classList.add('active');
  document.getElementById('modal-root').innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:460px"><button class="modal-close" onclick="closeModal()">✕</button><div class="modal-hdr"><div class="title-sm">NOTIFICATIONS</div></div><div class="modal-body" style="padding:0"><div style="padding:40px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--si)">Notifications delivered via live event feed.</div></div></div></div>`;
};

/* ══ TOAST / ACHIEVEMENT ══════════════════════════════════ */
window.showToast=(msg,type='info')=>{
  const d=document.createElement('div');d.className=`toast ${type}`;
  d.innerHTML=`<span>${{success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'}[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(d);
  setTimeout(()=>{d.style.opacity='0';d.style.transform='translateX(20px)';d.style.transition='all .3s';setTimeout(()=>d.remove(),300);},3500);
};

function showAchievement(icon,name){
  const p=document.getElementById('achievement-popup');if(!p)return;
  document.getElementById('ach-icon').textContent=icon;
  document.getElementById('ach-name').textContent=name;
  p.classList.remove('hidden');setTimeout(()=>p.classList.add('hidden'),4000);
}

/* ══ CURSOR ═══════════════════════════════════════════════ */
const dot=document.getElementById('cursor-dot'),ring=document.getElementById('cursor-ring');
let rx=0,ry=0;
document.addEventListener('mousemove',e=>{dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';});
setInterval(()=>{rx+=(parseFloat(dot.style.left||0)-rx)*.12;ry+=(parseFloat(dot.style.top||0)-ry)*.12;ring.style.left=rx+'px';ring.style.top=ry+'px';},16);
function setupCursorHover(){document.querySelectorAll('a,button,[onclick],.event-card,.ch-card,.org-nav-item,.role-card,.hint-hdr').forEach(el=>{el.addEventListener('mouseenter',()=>{dot.classList.add('hover');ring.classList.add('hover');});el.addEventListener('mouseleave',()=>{dot.classList.remove('hover');ring.classList.remove('hover');});});}

/* ══ CANVAS BG ════════════════════════════════════════════ */
const bc=document.getElementById('bg-canvas'),bx=bc.getContext('2d');
let BW=0,BH=0,bn=[];
function resizeBG(){BW=bc.width=innerWidth;BH=bc.height=innerHeight;}
window.addEventListener('resize',resizeBG);resizeBG();
bn=Array.from({length:75},()=>({x:Math.random()*BW,y:Math.random()*BH,vx:(Math.random()-.5)*.18,vy:(Math.random()-.5)*.18,r:Math.random()*1.2+.3,op:Math.random()*.28+.05,tw:Math.random()*Math.PI*2,ts:Math.random()*1.1+.4}));
let bgT=0;
(function bgLoop(){
  bgT+=.006;bx.clearRect(0,0,BW,BH);
  const g=bx.createLinearGradient(0,0,0,BH);g.addColorStop(0,'#020208');g.addColorStop(1,'#04040F');bx.fillStyle=g;bx.fillRect(0,0,BW,BH);
  for(let i=0;i<bn.length;i++){for(let j=i+1;j<bn.length;j++){const dx=bn[i].x-bn[j].x,dy=bn[i].y-bn[j].y,d=Math.hypot(dx,dy);if(d<105){bx.strokeStyle=`rgba(0,245,255,${(1-d/105)*.05})`;bx.lineWidth=.5;bx.beginPath();bx.moveTo(bn[i].x,bn[i].y);bx.lineTo(bn[j].x,bn[j].y);bx.stroke();}}}
  for(const n of bn){n.tw+=n.ts*.014;n.x+=n.vx;n.y+=n.vy;if(n.x<0)n.x=BW;if(n.x>BW)n.x=0;if(n.y<0)n.y=BH;if(n.y>BH)n.y=0;bx.fillStyle=`rgba(0,245,255,${n.op*(.5+.5*Math.sin(n.tw))})`;bx.beginPath();bx.arc(n.x,n.y,n.r,0,Math.PI*2);bx.fill();}
  const by=((bgT*.07)%1)*BH;const bg2=bx.createLinearGradient(0,by-14,0,by+14);bg2.addColorStop(0,'transparent');bg2.addColorStop(.5,'rgba(0,245,255,.016)');bg2.addColorStop(1,'transparent');bx.fillStyle=bg2;bx.fillRect(0,by-14,BW,28);
  requestAnimationFrame(bgLoop);
})();

/* ══ BOOT ══════════════════════════════════════════════════ */
window.navigate=navigate;
// Add socket.io client script
if(typeof io==='undefined'){
  const s=document.createElement('script');
  s.src=(window.location.port==='8080'||window.location.hostname==='localhost'?'http://localhost:3001':'')+'/socket.io/socket.io.js';
  s.onload=()=>console.log('[WS] Socket.io loaded');
  document.head.appendChild(s);
}
render();
})();