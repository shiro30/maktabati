(function(){
  const KEY='maktabati-theme';
  const saved=localStorage.getItem(KEY);
  const prefers=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme=saved || (prefers?'dark':'light');
  document.documentElement.setAttribute('data-theme',theme);
  function install(){
    if(document.getElementById('mkThemeToggle')) return;
    const b=document.createElement('button');
    b.id='mkThemeToggle'; b.type='button';
    b.title='تبديل الوضع'; b.setAttribute('aria-label','تبديل الوضع الليلي والضوئي');
    function paint(){
      const dark=document.documentElement.getAttribute('data-theme')==='dark';
      b.innerHTML=dark?'☀️ <span>الوضع الضوئي</span>':'🌙 <span>الوضع الليلي</span>';
    }
    b.addEventListener('click',()=>{
      const next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
      document.documentElement.setAttribute('data-theme',next); localStorage.setItem(KEY,next); paint();
    });
    document.body.appendChild(b); paint();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
