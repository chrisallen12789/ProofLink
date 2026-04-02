const engine = require('../../../shared/proposal-document-engine.js');

describe('shared/proposal-document-engine', () => {
  test('renders a visible placeholder logo block when no tenant logo is configured', () => {
    const html = engine.renderDocumentPage({
      template_type: engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL,
      title: 'North Campus Repairs',
      options: [
        {
          option_title: 'Base repair',
          price_amount_cents: 125000,
          scope_content: '- Repair the damaged section\n  - Coordinate access with the site contact',
        },
      ],
      branding: {
        company_name: 'Acme Services',
      },
      sender: {
        full_name: 'Jordan Price',
        job_title: 'Estimator',
      },
    });

    expect(html).toContain('Logo not configured');
    expect(html).toContain('North Campus Repairs');
  });

  test('sender fallback uses the tenant default signer when the selected sender is incomplete', () => {
    const model = engine.buildProposalViewModel({
      document: {
        template_type: engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL,
        title: 'Campus wash proposal',
      },
      options: [
        {
          option_title: 'Standard wash',
          price_amount_cents: 99000,
          scope_content: '- Pressure wash the exterior surfaces',
        },
      ],
      tenantBrandingProfile: {
        company_name: 'Clearline Exterior',
        email: 'office@clearline.test',
        phone: '555-222-1000',
      },
      senderProfile: {
        full_name: '',
      },
      defaultSenderProfile: {
        full_name: 'Morgan Tate',
        job_title: 'Division Manager',
        email: 'morgan@clearline.test',
        phone: '555-222-3000',
        initials: 'MT',
      },
    });

    expect(model.sender.fullName).toBe('Morgan Tate');
    expect(model.sender.jobTitle).toBe('Division Manager');
    expect(model.sender.email).toBe('morgan@clearline.test');
    expect(model.sender.phone).toBe('555-222-3000');
    expect(model.sender.initials).toBe('MT');
  });

  test('renders multi-option operational proposals with separate prices and scopes', () => {
    const html = engine.renderDocumentPage({
      template_type: engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL,
      title: 'Mt. Carmel proposal',
      intro_text: 'We reviewed the site and prepared three service paths.',
      options: [
        {
          option_title: 'Option 1 - Spot repair',
          price_amount_cents: 150000,
          scope_content: '- Repair the isolated section',
        },
        {
          option_title: 'Option 2 - Section replacement',
          price_amount_cents: 325000,
          scope_content: '- Replace the affected section\n  - Reset trim and seal transitions',
        },
        {
          option_title: 'Option 3 - Full package',
          price_amount_cents: 540000,
          scope_content: '- Replace the full area\n  - Final walkthrough and cleanup',
        },
      ],
      sender: {
        full_name: 'Jamie Torres',
        job_title: 'Project Manager',
      },
    });

    expect(html).toContain('Option 1 - Spot repair');
    expect(html).toContain('Option 2 - Section replacement');
    expect(html).toContain('Option 3 - Full package');
    expect(html).toContain('$1,500.00');
    expect(html).toContain('$3,250.00');
    expect(html).toContain('$5,400.00');
  });

  test('renders the formal vendor template with a fee schedule table', () => {
    const html = engine.renderDocumentPage({
      template_type: engine.TEMPLATE_TYPES.FORMAL_VENDOR,
      project_name: 'Valicor compliance services',
      intro_text: 'Thank you for the opportunity to submit our proposal.',
      value_proposition_text: 'Our team will manage documentation, coordination, and field execution.',
      options: [
        {
          option_title: 'Base services',
          notes: 'Core field execution and reporting.',
          fee_rows: [
            { label: 'Mobilization', amount_cents: 85000 },
            { label: 'Field services', amount_cents: 420000 },
          ],
          scope_content: '- Site coordination\n- Documentation package',
        },
      ],
      sender: {
        full_name: 'Alex Reed',
        job_title: 'Operations Manager',
      },
    });

    expect(html).toContain('Fee Schedule');
    expect(html).toContain('Mobilization');
    expect(html).toContain('Field services');
    expect(html).toContain('$850.00');
    expect(html).toContain('$4,200.00');
    expect(html).toContain('Acceptance');
  });
});
