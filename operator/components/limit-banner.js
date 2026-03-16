export function renderLimitBanner({
  title = "Upgrade required",
  message = "Your current plan limit has been reached.",
  upgradeTier = "growth",
  resourceLabel = "resource"
} = {}) {
  return `
    <section class="pl-limit-banner" data-upgrade-tier="${upgradeTier}">
      <div class="pl-limit-banner__body">
        <h3>${title}</h3>
        <p>${message}</p>
        <p>Upgrade to ${upgradeTier} to keep adding ${resourceLabel.toLowerCase()}.</p>
        <div class="pl-limit-banner__actions">
          <button type="button" class="pl-upgrade-btn" data-open-billing="true">Upgrade plan</button>
        </div>
      </div>
    </section>
  `;
}
