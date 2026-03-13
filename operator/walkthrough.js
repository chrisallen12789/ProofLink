// operator/walkthrough.js
// Guided onboarding walkthrough for new operators.
// Shows a dismissible 5-step wizard on first login.
// Does NOT modify the existing operator authentication system.

(function () {
  'use strict';

  var STORAGE_KEY = 'prooflink_walkthrough_dismissed';

  function isDismissed() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    var overlay = document.getElementById('pl-walkthrough-overlay');
    if (overlay) overlay.remove();
  }

  function isLoggedIn() {
    return !!sessionStorage.getItem('pl_op_token');
  }

  var currentStep = 1;
  var totalSteps = 5;

  var steps = [
    {
      title: 'Welcome to ProofLink',
      icon: '👋',
      body: '<p>Your store has been approved and provisioned. This quick walkthrough will help you get started.</p>'
        + '<p style="margin-top:.75rem;color:var(--muted,#6b6560)">You can dismiss this at any time and come back to it from the Guidance tab.</p>',
    },
    {
      title: 'Connect Stripe',
      icon: '💳',
      body: '<p>Connect your Stripe account to accept payments from your customers.</p>'
        + '<ol style="margin-top:.75rem;padding-left:1.25rem;line-height:2">'
        + '<li>Go to <strong>Payments</strong> in the sidebar</li>'
        + '<li>Click <strong>Connect Stripe</strong></li>'
        + '<li>Complete the Stripe onboarding flow</li>'
        + '<li>Return here when finished</li>'
        + '</ol>'
        + '<p style="margin-top:.75rem;color:var(--muted,#6b6560)">Stripe Connect handles payouts directly to your bank account.</p>',
    },
    {
      title: 'Add Your First Product',
      icon: '📦',
      body: '<p>Add at least one product or service to your catalog.</p>'
        + '<ol style="margin-top:.75rem;padding-left:1.25rem;line-height:2">'
        + '<li>Go to <strong>Products</strong> in the sidebar</li>'
        + '<li>Click <strong>New Product</strong></li>'
        + '<li>Enter a name, price, and description</li>'
        + '<li>Save and publish the product</li>'
        + '</ol>',
    },
    {
      title: 'Configure Your Storefront',
      icon: '🎨',
      body: '<p>Customize how your storefront looks to customers.</p>'
        + '<ul style="margin-top:.75rem;padding-left:1.25rem;line-height:2">'
        + '<li>Set your business name and tagline</li>'
        + '<li>Upload your logo</li>'
        + '<li>Choose your brand color</li>'
        + '<li>Configure delivery zones and hours</li>'
        + '</ul>'
        + '<p style="margin-top:.75rem;color:var(--muted,#6b6560)">Your storefront URL is shown in the Dashboard view.</p>',
    },
    {
      title: 'Launch Your Store',
      icon: '🚀',
      body: '<p>You\'re all set! Here\'s what happens next:</p>'
        + '<ul style="margin-top:.75rem;padding-left:1.25rem;line-height:2">'
        + '<li>Share your storefront link with customers</li>'
        + '<li>Track orders and customers from this dashboard</li>'
        + '<li>Monitor your revenue in the Money tab</li>'
        + '<li>Use the Guidance tab for tips and best practices</li>'
        + '</ul>'
        + '<p style="margin-top:1rem"><strong>You\'re ready to go. Good luck!</strong></p>',
    },
  ];

  function renderStep() {
    var step = steps[currentStep - 1];
    var progressDots = '';
    for (var i = 1; i <= totalSteps; i++) {
      var cls = i === currentStep ? 'pl-wt-dot active' : (i < currentStep ? 'pl-wt-dot done' : 'pl-wt-dot');
      progressDots += '<div class="' + cls + '"></div>';
    }

    var nav = '<div class="pl-wt-nav">';
    if (currentStep > 1) {
      nav += '<button class="pl-wt-btn pl-wt-btn-ghost" onclick="plWalkthroughPrev()">Back</button>';
    } else {
      nav += '<div></div>';
    }
    nav += '<div class="pl-wt-progress">' + progressDots + '</div>';
    if (currentStep < totalSteps) {
      nav += '<button class="pl-wt-btn pl-wt-btn-primary" onclick="plWalkthroughNext()">Next</button>';
    } else {
      nav += '<button class="pl-wt-btn pl-wt-btn-primary" onclick="plWalkthroughDismiss()">Get Started</button>';
    }
    nav += '</div>';

    var html = '<div class="pl-wt-card">'
      + '<button class="pl-wt-close" onclick="plWalkthroughDismiss()" title="Dismiss walkthrough">&times;</button>'
      + '<div class="pl-wt-icon">' + step.icon + '</div>'
      + '<div class="pl-wt-step-label">Step ' + currentStep + ' of ' + totalSteps + '</div>'
      + '<h2 class="pl-wt-title">' + step.title + '</h2>'
      + '<div class="pl-wt-body">' + step.body + '</div>'
      + nav
      + '</div>';

    var container = document.getElementById('pl-walkthrough-content');
    if (container) container.innerHTML = html;
  }

  function show() {
    if (isDismissed()) return;

    // Inject styles
    var style = document.createElement('style');
    style.textContent = ''
      + '.pl-wt-overlay { position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem; }'
      + '.pl-wt-card { background:#fff;border-radius:12px;max-width:520px;width:100%;padding:2rem;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.25); }'
      + '.pl-wt-close { position:absolute;top:.75rem;right:.75rem;background:none;border:none;font-size:1.5rem;color:#999;cursor:pointer;line-height:1;padding:.25rem; }'
      + '.pl-wt-close:hover { color:#333; }'
      + '.pl-wt-icon { font-size:2.5rem;margin-bottom:.75rem; }'
      + '.pl-wt-step-label { font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#999;margin-bottom:.4rem; }'
      + '.pl-wt-title { font-size:1.4rem;font-weight:800;color:#0d0d0b;margin-bottom:.75rem;letter-spacing:-.02em; }'
      + '.pl-wt-body { font-size:.9rem;color:#444;line-height:1.7; }'
      + '.pl-wt-body p { margin:0 0 .5rem; }'
      + '.pl-wt-nav { display:flex;align-items:center;justify-content:space-between;margin-top:1.5rem;gap:.5rem; }'
      + '.pl-wt-progress { display:flex;gap:.4rem;align-items:center; }'
      + '.pl-wt-dot { width:8px;height:8px;border-radius:50%;background:#ddd; }'
      + '.pl-wt-dot.active { background:#c84b2f;width:10px;height:10px; }'
      + '.pl-wt-dot.done { background:#2e7d32; }'
      + '.pl-wt-btn { padding:.5rem 1.2rem;border-radius:4px;font-size:.85rem;font-weight:600;cursor:pointer;border:1px solid #ddd;background:#fff;color:#666;font-family:inherit; }'
      + '.pl-wt-btn:hover { border-color:#c84b2f;color:#c84b2f; }'
      + '.pl-wt-btn-primary { background:#c84b2f;color:#fff;border-color:#c84b2f; }'
      + '.pl-wt-btn-primary:hover { background:#a83820;border-color:#a83820;color:#fff; }'
      + '.pl-wt-btn-ghost { background:transparent; }';
    document.head.appendChild(style);

    // Inject overlay
    var overlay = document.createElement('div');
    overlay.id = 'pl-walkthrough-overlay';
    overlay.className = 'pl-wt-overlay';
    overlay.innerHTML = '<div id="pl-walkthrough-content"></div>';
    document.body.appendChild(overlay);

    // Clicking overlay background dismisses
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) dismiss();
    });

    renderStep();
  }

  // Global functions for onclick handlers
  window.plWalkthroughNext = function () {
    if (currentStep < totalSteps) {
      currentStep++;
      renderStep();
    }
  };

  window.plWalkthroughPrev = function () {
    if (currentStep > 1) {
      currentStep--;
      renderStep();
    }
  };

  window.plWalkthroughDismiss = dismiss;

  // Show the walkthrough when the operator page loads (after auth)
  // Wait for the login to complete by observing DOM changes
  function tryShow() {
    // Only show if logged in (session token exists) and not dismissed
    if (!isLoggedIn() || isDismissed()) return;
    show();
  }

  // Check on page load and also after a short delay (to catch post-login state)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(tryShow, 1500);
    });
  } else {
    setTimeout(tryShow, 1500);
  }

  // Also watch for session token appearing (covers login flow)
  var origSetItem = sessionStorage.setItem.bind(sessionStorage);
  sessionStorage.setItem = function (key, value) {
    origSetItem(key, value);
    if (key === 'pl_op_token' && value) {
      setTimeout(tryShow, 500);
    }
  };
})();
