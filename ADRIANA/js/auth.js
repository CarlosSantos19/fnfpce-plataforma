// ═══ Login CNE - Cuentas Claras ═══
var _MSG_STYLES = {
  ok:   'color:#00e676',
  err:  'color:#ef5350',
  info: 'color:rgba(196,218,240,.65)',
  warn: 'color:rgba(252,209,22,.85)'
};
function _setMsg(msg, type, html){
  if(!msg) return;
  msg.style.cssText = _MSG_STYLES[type] || _MSG_STYLES.info;
  msg.innerHTML = html;
}
function _cneCheckSesion(){
  var overlay=document.getElementById('cneLoginOverlay');
  if(overlay) overlay.style.display='flex';
  var localSes=null;
  try{localSes=JSON.parse(localStorage.getItem('cne_portal_session')||'null');}catch(e){}
  var localOk=localSes && localSes.usuario && (Date.now()-localSes.ts)<3600000;
  fetch('/api/cne_status').then(r=>r.json()).then(function(d){
    var msg=document.getElementById('cneLoginOverlayMsg');
    if(d.sesion_activa && localOk && msg){
      _setMsg(msg, 'ok',
        '<i class="fa fa-check-circle me-1"></i>Sesión activa — <strong>'+localSes.usuario+'</strong> ('+Math.round(d.edad_min)+' min)<br>'+
        '<button onclick="document.getElementById(\'cneLoginOverlay\').style.display=\'none\'" '+
        'style="margin-top:.6rem;background:rgba(0,230,118,.12);border:1px solid #00e676;color:#00e676;border-radius:5px;padding:.35rem 1.1rem;cursor:pointer;font-size:.78rem">'+
        '<i class="fa fa-arrow-right me-1"></i>Continuar</button>');
      var uInp=document.getElementById('cneLoginUser');
      if(uInp&&!uInp.value) uInp.value=localSes.usuario;
    } else if(d.sesion_activa && msg){
      _setMsg(msg, 'info', '<i class="fa fa-lock me-1"></i>Ingrese sus credenciales para acceder al portal.');
    }
  }).catch(function(){});
}
function _cneLoginManual(){
  var user=document.getElementById('cneLoginUser').value.trim();
  var pass=document.getElementById('cneLoginPass').value.trim();
  var msg=document.getElementById('cneLoginOverlayMsg');
  var btn=document.getElementById('cneLoginBtn');
  if(!user||!pass){
    _setMsg(msg, 'err', '<i class="fa fa-exclamation-triangle me-1"></i>Ingrese usuario y contraseña');
    return;
  }
  btn.disabled=true;
  btn.innerHTML='<i class="fa fa-spinner fa-spin me-1"></i>Conectando con CNE...';
  _setMsg(msg, 'info', '<i class="fa fa-spinner fa-spin me-1"></i>Iniciando sesión en CNE-Cuentas Claras... (puede tardar ~15 segundos)');
  fetch('/api/cne_login_manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:user,password:pass})})
  .then(r=>r.json()).then(function(d){
    btn.disabled=false;
    btn.innerHTML='<i class="fa fa-sign-in-alt me-1"></i> Iniciar sesión';
    if(d.ok){
      try{localStorage.setItem('cne_portal_session',JSON.stringify({usuario:user,ts:Date.now()}));}catch(e){}
      fetch('data/busqueda.json').then(function(r){return r.json();}).then(function(b){
        var vacio=!b||!Object.keys(b).length;
        _setMsg(msg, 'ok', '<i class="fa fa-check-circle me-1"></i>'+d.mensaje+
          (vacio?'<div style="margin-top:.5rem"><button onclick="_cneIniciarIndice(this)" '+
          'style="background:rgba(252,209,22,.1);border:1px solid rgba(252,209,22,.5);color:rgba(252,209,22,.9);border-radius:5px;padding:.35rem 1rem;cursor:pointer;font-size:.76rem">'+
          '<i class="fa fa-download me-1"></i>Descargar datos de candidatos (necesario 1ª vez)</button></div>':''));
        if(!vacio) setTimeout(function(){document.getElementById('cneLoginOverlay').style.display='none';},1000);
      }).catch(function(){
        _setMsg(msg, 'ok', '<i class="fa fa-check-circle me-1"></i>'+d.mensaje);
        setTimeout(function(){document.getElementById('cneLoginOverlay').style.display='none';},1000);
      });
    } else {
      var detalle=d.detalle?'<div style="font-size:.75rem;opacity:.8;margin-top:.25rem">'+d.detalle+'</div>':'';
      _setMsg(msg, 'err', '<i class="fa fa-times-circle me-1"></i>'+d.mensaje+detalle);
    }
  }).catch(function(e){
    btn.disabled=false;
    btn.innerHTML='<i class="fa fa-sign-in-alt me-1"></i> Iniciar sesión';
    _setMsg(msg, 'err', '<i class="fa fa-times-circle me-1"></i>Error de conexión: '+e);
  });
}
function _cneIniciarIndice(btn){
  btn.disabled=true;
  btn.innerHTML='<i class="fa fa-spinner fa-spin me-1"></i>Iniciando descarga…';
  fetch('/api/construir_indice',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){
      btn.innerHTML='<i class="fa fa-spinner fa-spin me-1"></i>Descargando candidatos… (5-10 min)';
      _cneMonitorIndice(btn);
    } else {
      btn.disabled=false;
      btn.innerHTML='<i class="fa fa-exclamation-triangle me-1"></i>'+d.msg;
    }
  });
}
function _cneMonitorIndice(btn){
  var iv=setInterval(function(){
    fetch('/api/indice_status').then(function(r){return r.json();}).then(function(s){
      if(s.fase==='listo'){
        clearInterval(iv);
        btn.style.cssText='background:rgba(0,230,118,.12);border:1px solid #00e676;color:#00e676;border-radius:5px;padding:.35rem 1rem;cursor:pointer';
        btn.innerHTML='<i class="fa fa-check me-1"></i>'+s.msg;
        setTimeout(function(){
          document.getElementById('cneLoginOverlay').style.display='none';
          location.reload();
        },2000);
      } else if(s.fase==='error'){
        clearInterval(iv);
        btn.disabled=false;
        btn.style.cssText='background:rgba(239,83,80,.12);border:1px solid #ef5350;color:#ef5350;border-radius:5px;padding:.35rem 1rem;cursor:pointer';
        btn.innerHTML='<i class="fa fa-times me-1"></i>Error: '+s.error;
      } else {
        btn.innerHTML='<i class="fa fa-spinner fa-spin me-1"></i>'+s.msg+' ('+s.pct+'%)';
      }
    });
  },3000);
}
function _cneRequireLogin(){
  try{localStorage.removeItem('cne_portal_session');}catch(e){}
  var overlay=document.getElementById('cneLoginOverlay');
  if(overlay) overlay.style.display='flex';
  var msg=document.getElementById('cneLoginOverlayMsg');
  _setMsg(msg, 'warn', '<i class="fa fa-exclamation-triangle me-1"></i>Sesión cerrada. Inicie sesión nuevamente.');
  document.getElementById('cneLoginPass').value='';
}
