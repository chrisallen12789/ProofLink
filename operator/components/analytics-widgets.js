(function (global) {
  function safeMoney(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
  }
  function safeNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value || 0));
  }
  function renderCards(metrics) {
    metrics = metrics || {};
    var cards = [
      ['Revenue this month', safeMoney(metrics.revenueThisMonth)],
      ['Revenue last month', safeMoney(metrics.revenueLastMonth)],
      ['Order count', safeNumber(metrics.orderCountThisMonth)],
      ['Average order value', safeMoney(metrics.averageOrderValue)],
      ['New customers', safeNumber(metrics.newCustomersThisMonth)],
      ['Expenses this month', safeMoney(metrics.expensesThisMonth)],
      ['Outstanding orders', safeNumber(metrics.outstandingOrders)]
    ];
    return '<section class="pl-analytics-grid">' + cards.map(function (card) {
      return '<article class="pl-analytics-card"><p>' + card[0] + '</p><h3>' + card[1] + '</h3></article>';
    }).join('') + '</section>';
  }
  global.ProofLinkAnalyticsWidgets = { renderCards: renderCards };
})(window);
