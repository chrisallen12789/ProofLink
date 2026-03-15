import { planLabel } from "../../platform/upgrade-paths.js";

const FEATURES = [
  ["Products", "10", "Unlimited", "Unlimited"],
  ["Customers", "50", "Unlimited", "Unlimited"],
  ["Orders", "100", "Unlimited", "Unlimited"],
  ["Operator seats", "1", "5", "Unlimited"],
  ["Online checkout", "No", "Yes", "Yes"],
  ["Custom domain", "No", "Yes", "Yes"],
  ["Advanced exports", "No", "No", "Yes"],
  ["Automation rules", "No", "No", "Yes"]
];

export function renderPlanComparison(currentPlan = "starter") {
  const rows = FEATURES.map(row => `
    <tr>
      <td>${row[0]}</td>
      <td>${row[1]}</td>
      <td>${row[2]}</td>
      <td>${row[3]}</td>
    </tr>
  `).join("");

  return `
    <section class="pl-plan-comparison" data-current-plan="${currentPlan}">
      <header>
        <h2>Compare plans</h2>
        <p>Your current plan is <strong>${planLabel(currentPlan)}</strong>.</p>
      </header>

      <table class="pl-plan-comparison__table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Starter</th>
            <th>Growth</th>
            <th>Enterprise</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}
