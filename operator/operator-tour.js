(function(){
  var TOUR_KEY = 'pl_tour_v1';
  var step = 1;
  var TOTAL = 4;
  var autoShowAttempts = 0;
  var maxAutoShowAttempts = 20;

  function modal(){ return document.getElementById('tourModal'); }
  function viewApp(){ return document.getElementById('viewApp'); }
  function viewLogin(){ return document.getElementById('viewLogin'); }
  function viewPasswordSetup(){ return document.getElementById('viewPasswordSetup'); }
  function viewForgotPassword(){ return document.getElementById('viewForgotPassword'); }

  function isHidden(el){
    return !el || el.classList.contains('hidden');
  }

  function canAutoShowTour(){
    return (
      !localStorage.getItem(TOUR_KEY) &&
      window.PROOFLINK_BOOT_READY === true &&
      !isHidden(viewApp()) &&
      isHidden(viewLogin()) &&
      isHidden(viewPasswordSetup()) &&
      isHidden(viewForgotPassword())
    );
  }

  function goTo(n){
    step = Math.max(1, Math.min(n, TOTAL));
    document.querySelectorAll('.tour-step').forEach(function(el,i){
      el.classList.toggle('active', i+1===step);
    });
    document.querySelectorAll('.tour-dot').forEach(function(el,i){
      el.classList.toggle('active', i+1===step);
    });
  }

  window.tourNext = function(){ goTo(step+1); };
  window.tourBack = function(){ goTo(step-1); };
  window.tourFinish = function(){
    localStorage.setItem(TOUR_KEY,'1');
    modal().classList.add('hidden');
  };

  window.showTour = function(){
    goTo(1);
    modal().classList.remove('hidden');
  };

  document.querySelector('.tour-backdrop').addEventListener('click', window.tourFinish);

  // Exposed so operator.js can re-trigger the tour check after a post-password-setup boot,
  // by which point the page-load poll may have already expired.
  window.__plTourReady = maybeAutoShowTour;

  function maybeAutoShowTour(){
    if (canAutoShowTour()) {
      goTo(1);
      modal().classList.remove('hidden');
      return;
    }

    autoShowAttempts += 1;
    if (autoShowAttempts < maxAutoShowAttempts && !localStorage.getItem(TOUR_KEY)) {
      setTimeout(maybeAutoShowTour, 600);
    }
  }

  if (!localStorage.getItem(TOUR_KEY)) {
    setTimeout(maybeAutoShowTour, 900);
  }
})();
