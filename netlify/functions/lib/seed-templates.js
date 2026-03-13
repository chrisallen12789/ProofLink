// FILE: netlify/functions/lib/seed-templates.js
//
// Industry-specific seed templates for ProofLink tenant provisioning.
//
// When a tenant is provisioned, seedTemplateForTenant() is called with the
// tenant's seed_template_key (set from business_type on the join form).
//
// Each template seeds:
//   - products rows (the storefront catalog)
//   - tenant_config site_settings (order_flow, currency, schedule notes)
//
// All products use the existing products table schema:
//   name, slug, category, description, pricing_mode, sell_price_cents,
//   starting_price_cents, delivery_eligible, is_active, is_available,
//   sort_order, tenant_id, operator_id
//
// Pricing modes:
//   fixed     — exact price shown on storefront
//   starts_at — floor price shown; final confirmed after scoping
//   quote     — no price shown; operator issues quote after assessment

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dollars(amount) {
  // Convert dollar amount to cents integer
  return Math.round(Number(amount) * 100);
}

function buildProduct(tenantId, operatorId, sortOrder, {
  name,
  category,
  description,
  pricing_mode,
  sell_price,       // dollars, only for fixed
  starting_price,   // dollars, only for starts_at
  delivery_eligible = false,
}) {
  return {
    tenant_id             : tenantId,
    operator_id           : operatorId,
    name,
    slug                  : slugify(name),
    category,
    description           : description || '',
    pricing_mode,
    sell_price_cents      : pricing_mode === 'fixed'     ? dollars(sell_price || 0)     : 0,
    starting_price_cents  : pricing_mode === 'starts_at' ? dollars(starting_price || 0) : 0,
    delivery_eligible,
    is_active             : true,
    is_available          : true,
    sort_order            : sortOrder,
    created_at            : new Date().toISOString(),
    updated_at            : new Date().toISOString(),
  };
}

// ── Template Definitions ──────────────────────────────────────────────────────

const TEMPLATES = {

  // ── Pressure Washing ───────────────────────────────────────────────────────
  pressure_washing: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Wet conditions may require rescheduling. 24-hour notice needed for cancellations.',
    },
    products: [
      { name: 'House Wash — Single Story',      category: 'Residential',  pricing_mode: 'starts_at', starting_price: 149,  description: 'Siding, fascia, and gutters exterior. Starting price; adjusted for square footage and condition.' },
      { name: 'House Wash — Two Story',          category: 'Residential',  pricing_mode: 'starts_at', starting_price: 229,  description: 'Full exterior including second story. Ladder work and rinse included.' },
      { name: 'Driveway & Walkway Clean',        category: 'Flatwork',     pricing_mode: 'starts_at', starting_price: 89,   description: 'Concrete or paver surface cleaning. Starting rate; adjusted by square footage.' },
      { name: 'Deck / Patio Wash',               category: 'Flatwork',     pricing_mode: 'starts_at', starting_price: 99,   description: 'Wood, composite, or concrete deck. Stain prep available as add-on.' },
      { name: 'Fence Wash',                      category: 'Residential',  pricing_mode: 'starts_at', starting_price: 79,   description: 'Wood or vinyl fence wash. Starting rate per linear foot.' },
      { name: 'Gutter Flush',                    category: 'Residential',  pricing_mode: 'fixed',     sell_price: 75,        description: 'Interior flush of gutters and downspouts.' },
      { name: 'Roof Soft Wash',                  category: 'Roof',         pricing_mode: 'quote',                           description: 'Low-pressure soft wash treatment. Always quoted after photo review.' },
      { name: 'Commercial Building Wash',        category: 'Commercial',   pricing_mode: 'quote',                           description: 'Multi-unit or commercial facade. Requires photo review for quote.' },
      { name: 'Fleet / Equipment Wash',          category: 'Commercial',   pricing_mode: 'quote',                           description: 'Vehicles or heavy equipment. Quoted based on count and soil level.' },
    ],
  },

  // ── Cleaning Services ──────────────────────────────────────────────────────
  cleaning: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'First visit requires a 4-hour window. Recurring visits require a 2-hour window.',
    },
    products: [
      { name: 'Standard Clean — 1BR / 1BA',      category: 'Residential Recurring', pricing_mode: 'fixed',     sell_price: 95,   description: 'Kitchen, bathroom, vacuum, mop, and all surfaces. Bi-weekly or weekly.' },
      { name: 'Standard Clean — 2BR / 2BA',      category: 'Residential Recurring', pricing_mode: 'fixed',     sell_price: 135,  description: 'Full home recurring clean. Fixed rate per visit.' },
      { name: 'Standard Clean — 3BR / 2BA',      category: 'Residential Recurring', pricing_mode: 'fixed',     sell_price: 165,  description: 'Fixed recurring rate. Homes larger than standard quoted separately.' },
      { name: 'Deep Clean — One Time',            category: 'One-Time',              pricing_mode: 'starts_at', starting_price: 195, description: 'Inside appliances, baseboards, blinds, behind furniture. Higher labor time.' },
      { name: 'Move-In / Move-Out Clean',         category: 'One-Time',              pricing_mode: 'quote',                       description: 'Full empty-unit clean. Quoted based on size and condition.' },
      { name: 'Post-Construction Clean',          category: 'Specialty',             pricing_mode: 'quote',                       description: 'Debris removal, construction dust, builder grime. Photo quote required.' },
      { name: 'Commercial Office Clean',          category: 'Commercial',            pricing_mode: 'quote',                       description: 'Per-visit commercial clean. Scope and frequency confirmed at quote.' },
      { name: 'Add-On: Inside Oven',              category: 'Add-Ons',               pricing_mode: 'fixed',     sell_price: 35,   description: 'Oven interior deep clean added to any visit.' },
      { name: 'Add-On: Inside Fridge',            category: 'Add-Ons',               pricing_mode: 'fixed',     sell_price: 35,   description: 'Fridge interior clean with drawer removal.' },
      { name: 'Add-On: Interior Windows',         category: 'Add-Ons',               pricing_mode: 'starts_at', starting_price: 40, description: 'Interior window cleaning. Starting rate per quantity.' },
    ],
  },

  // ── Lawn Care / Landscaping ────────────────────────────────────────────────
  lawn_care: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Service days vary by route. We will confirm your scheduled day at booking.',
    },
    products: [
      { name: 'Lawn Mowing — Small (under 5k sqft)',  category: 'Recurring Maintenance', pricing_mode: 'fixed',     sell_price: 45,   description: 'Mow, edge, and blow. Weekly or bi-weekly.' },
      { name: 'Lawn Mowing — Medium (5k–12k sqft)',   category: 'Recurring Maintenance', pricing_mode: 'fixed',     sell_price: 65,   description: 'Mow, edge, and blow. Weekly or bi-weekly.' },
      { name: 'Lawn Mowing — Large (12k+ sqft)',      category: 'Recurring Maintenance', pricing_mode: 'starts_at', starting_price: 85, description: 'Starting rate; adjusted at property assessment.' },
      { name: 'Full Maintenance Package',             category: 'Recurring Maintenance', pricing_mode: 'starts_at', starting_price: 120, description: 'Mow, edge, trim shrubs, blow, and spot weed. All-in monthly rate.' },
      { name: 'Spring Cleanup',                       category: 'Seasonal',              pricing_mode: 'starts_at', starting_price: 149, description: 'Debris removal, bed cleanup, edging, and first mow of season.' },
      { name: 'Fall Cleanup',                         category: 'Seasonal',              pricing_mode: 'starts_at', starting_price: 149, description: 'Leaf removal, bed prep, and final cut.' },
      { name: 'Mulch Installation',                   category: 'Landscape Projects',    pricing_mode: 'starts_at', starting_price: 180, description: 'Per yard delivered and installed. 2-yard minimum.' },
      { name: 'Tree & Shrub Trimming',                category: 'Landscape Projects',    pricing_mode: 'starts_at', starting_price: 95,  description: 'Small to medium ornamentals. Large trees quoted separately.' },
      { name: 'Bed Renovation',                       category: 'Landscape Projects',    pricing_mode: 'quote',                          description: 'Remove existing, amend soil, replant. Quoted with site visit.' },
      { name: 'Sod Installation',                     category: 'Landscape Projects',    pricing_mode: 'quote',                          description: 'Per square foot. Quote includes soil prep, delivery, and install.' },
      { name: 'Irrigation Startup / Winterize',       category: 'Seasonal',              pricing_mode: 'fixed',     sell_price: 85,  description: 'Spring turn-on or fall blowout. Includes zone check.' },
    ],
  },

  // ── Handyman ───────────────────────────────────────────────────────────────
  handyman: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Describe your job list in the notes field so we can confirm the right time block.',
    },
    products: [
      { name: 'Handyman — 1 Hour',              category: 'Hourly',         pricing_mode: 'fixed',     sell_price: 85,   description: '1-hour minimum. Good for single repairs and small punch list items.' },
      { name: 'Handyman — 2 Hours',             category: 'Hourly',         pricing_mode: 'fixed',     sell_price: 160,  description: 'Common for 2–4 item punch lists.' },
      { name: 'Handyman — Half Day (4 hrs)',    category: 'Hourly',         pricing_mode: 'fixed',     sell_price: 300,  description: '4-hour block for larger lists or small projects.' },
      { name: 'Handyman — Full Day (8 hrs)',    category: 'Hourly',         pricing_mode: 'fixed',     sell_price: 550,  description: 'Full-day project rate. Scope confirmed at booking.' },
      { name: 'TV Mounting',                    category: 'Installations',  pricing_mode: 'fixed',     sell_price: 99,   description: 'Up to 65". Full-motion or fixed mount. Includes level and anchors.' },
      { name: 'Furniture Assembly',             category: 'Assembly',       pricing_mode: 'starts_at', starting_price: 55, description: 'Flat-pack or IKEA furniture. Starting rate per piece.' },
      { name: 'Shelf / Storage Install',        category: 'Installations',  pricing_mode: 'starts_at', starting_price: 45, description: 'Floating shelves, closet rods, and wall brackets.' },
      { name: 'Door Adjustment / Hardware',     category: 'Doors',          pricing_mode: 'starts_at', starting_price: 65, description: 'Adjust, rehang, or replace interior door hardware.' },
      { name: 'Drywall Patch',                  category: 'Drywall',        pricing_mode: 'starts_at', starting_price: 75, description: 'Tape, mud, sand, and prime. Paint not included.' },
      { name: 'Caulking & Weatherstripping',   category: 'Weatherproofing', pricing_mode: 'starts_at', starting_price: 55, description: 'Tub, window, or exterior door sealing.' },
      { name: 'Gutter Clean — Single Story',   category: 'Exterior',        pricing_mode: 'fixed',     sell_price: 99,   description: 'Debris removal and downspout flush. Single-story residential.' },
    ],
  },

  // ── HVAC ───────────────────────────────────────────────────────────────────
  hvac: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Diagnostic fee applies to all service calls and is credited toward repair if authorized same visit.',
    },
    products: [
      { name: 'Diagnostic Service Call',         category: 'Service & Repair',          pricing_mode: 'fixed',     sell_price: 89,   description: 'First-hour diagnostic. Fee applied toward repair if authorized same visit.' },
      { name: 'AC Tune-Up / Maintenance',        category: 'Preventative Maintenance',  pricing_mode: 'fixed',     sell_price: 119,  description: 'Filter check, coil clean, refrigerant check, thermostat test.' },
      { name: 'Furnace Tune-Up',                 category: 'Preventative Maintenance',  pricing_mode: 'fixed',     sell_price: 109,  description: 'Heat exchanger inspect, igniter test, flue check, filter.' },
      { name: 'AC Repair — Common Issue',        category: 'Service & Repair',          pricing_mode: 'starts_at', starting_price: 149, description: 'Capacitor, contactor, relay. Parts and labor. Starting rate.' },
      { name: 'AC Repair — Major',               category: 'Service & Repair',          pricing_mode: 'quote',                        description: 'Compressor, coil, refrigerant leak repair. Quoted after diagnosis.' },
      { name: 'Furnace Repair',                  category: 'Service & Repair',          pricing_mode: 'quote',                        description: 'Igniter, heat exchanger, gas valve. Quoted after diagnosis.' },
      { name: 'Refrigerant Recharge',            category: 'Service & Repair',          pricing_mode: 'starts_at', starting_price: 140, description: 'Leak test included. Per-pound rate from starting price.' },
      { name: 'Thermostat Install / Program',    category: 'Service & Repair',          pricing_mode: 'fixed',     sell_price: 95,   description: 'Smart or standard thermostat. Includes programming and test.' },
      { name: 'Filter Replacement Service',      category: 'Preventative Maintenance',  pricing_mode: 'fixed',     sell_price: 35,   description: 'Supply and install standard 1-inch filter.' },
      { name: 'New System Install — AC',         category: 'Installation',              pricing_mode: 'quote',                        description: 'Full system swap or new install. Quoted in person after load calculation.' },
      { name: 'New System Install — HVAC',       category: 'Installation',              pricing_mode: 'quote',                        description: 'Full heat and cool replacement. Quoted in person.' },
      { name: 'Duct Inspection / Sealing',       category: 'Service & Repair',          pricing_mode: 'starts_at', starting_price: 120, description: 'Visual inspection and leak sealing. Starting rate; scope varies.' },
    ],
  },

  // ── Plumbing ───────────────────────────────────────────────────────────────
  plumbing: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Diagnostic fee applies to all service calls and is credited toward authorized same-visit repairs.',
    },
    products: [
      { name: 'Service Call / Diagnostic',       category: 'Service & Repair',  pricing_mode: 'fixed',     sell_price: 89,   description: 'Includes first-hour diagnostic. Applied toward repair if authorized same visit.' },
      { name: 'Drain Cleaning — Sink / Tub',     category: 'Service & Repair',  pricing_mode: 'fixed',     sell_price: 125,  description: 'Snake or hydro. Single bathroom or kitchen drain.' },
      { name: 'Drain Cleaning — Main Line',      category: 'Service & Repair',  pricing_mode: 'starts_at', starting_price: 245, description: 'Main line snake or hydro-jet. Camera inspection available as add-on.' },
      { name: 'Faucet Repair / Replace',         category: 'Service & Repair',  pricing_mode: 'starts_at', starting_price: 95,  description: 'Labor plus parts. Customer-supplied or contractor-supplied fixture.' },
      { name: 'Toilet Repair',                   category: 'Service & Repair',  pricing_mode: 'starts_at', starting_price: 85,  description: 'Flapper, fill valve, or wax ring. Parts and labor.' },
      { name: 'Water Heater Repair',             category: 'Service & Repair',  pricing_mode: 'quote',                          description: 'Element, thermostat, or anode rod. Quoted after diagnosis.' },
      { name: 'Water Heater Replacement',        category: 'Installation',       pricing_mode: 'quote',                          description: 'Tank or tankless. Quoted with permit requirement check.' },
      { name: 'Leak Detection & Repair',         category: 'Service & Repair',  pricing_mode: 'quote',                          description: 'Slab, supply line, or under-sink. Scope varies; quoted after assessment.' },
      { name: 'Garbage Disposal Install',        category: 'Installation',       pricing_mode: 'starts_at', starting_price: 115, description: 'Standard install. Customer-supplied or contractor unit.' },
      { name: 'Camera Inspection',               category: 'Diagnostic',         pricing_mode: 'fixed',     sell_price: 175,  description: 'Video inspection of drain line. Results documented in job notes.' },
      { name: 'Emergency Service Call',          category: 'Emergency',          pricing_mode: 'starts_at', starting_price: 175, description: 'After-hours and weekend premium rate. 1-hour minimum.' },
    ],
  },

  // ── Pet Services ───────────────────────────────────────────────────────────
  pet_services: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Please include your pet\'s name, breed, and any behavioral notes when booking.',
    },
    products: [
      { name: 'Dog Wash — Small (under 25 lbs)',   category: 'Grooming',      pricing_mode: 'fixed',     sell_price: 35,  description: 'Bath, blow dry, brush, ear clean, nail trim.' },
      { name: 'Dog Wash — Medium (25–60 lbs)',     category: 'Grooming',      pricing_mode: 'fixed',     sell_price: 55,  description: 'Bath, blow dry, brush, ear clean, nail trim.' },
      { name: 'Dog Wash — Large (60+ lbs)',        category: 'Grooming',      pricing_mode: 'fixed',     sell_price: 75,  description: 'Bath, blow dry, brush, ear clean, nail trim.' },
      { name: 'Full Groom — Small',                category: 'Grooming',      pricing_mode: 'fixed',     sell_price: 55,  description: 'Bath plus breed-specific cut. Small dog.' },
      { name: 'Full Groom — Medium',               category: 'Grooming',      pricing_mode: 'fixed',     sell_price: 75,  description: 'Bath plus breed-specific cut. Medium dog.' },
      { name: 'Full Groom — Large',                category: 'Grooming',      pricing_mode: 'starts_at', starting_price: 95, description: 'Bath plus breed-specific cut. Large or double-coat breeds quoted.' },
      { name: 'Nail Trim Only',                    category: 'Add-Ons',       pricing_mode: 'fixed',     sell_price: 18,  description: 'Nail trim and file. Walk-in available.' },
      { name: 'Dog Walking — 30 min',              category: 'Walking',        pricing_mode: 'fixed',     sell_price: 22,  description: 'Solo or small group walk. GPS route logged.' },
      { name: 'Dog Walking — 60 min',              category: 'Walking',        pricing_mode: 'fixed',     sell_price: 38,  description: 'Extended solo walk. Includes post-walk report.' },
      { name: 'Drop-In Visit',                     category: 'Pet Sitting',    pricing_mode: 'fixed',     sell_price: 25,  description: '30-minute home visit. Feed, water, play, and potty break.' },
      { name: 'Overnight Pet Sitting',             category: 'Pet Sitting',    pricing_mode: 'starts_at', starting_price: 65, description: 'In-home overnight stay. Starting rate per night.' },
    ],
  },

  // ── Photography ────────────────────────────────────────────────────────────
  photography: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Sessions are confirmed after a brief intake call to discuss your vision and location.',
    },
    products: [
      { name: 'Mini Session — 30 min',            category: 'Portrait',         pricing_mode: 'fixed',     sell_price: 195, description: '30-minute session. 1 location. 15 edited digital images.' },
      { name: 'Standard Session — 1 Hour',        category: 'Portrait',         pricing_mode: 'fixed',     sell_price: 350, description: '1-hour session. Up to 2 locations. 40 edited digital images.' },
      { name: 'Extended Session — 2 Hours',       category: 'Portrait',         pricing_mode: 'fixed',     sell_price: 550, description: '2-hour session. Multiple locations. 75+ edited digital images.' },
      { name: 'Family Session',                   category: 'Family',           pricing_mode: 'starts_at', starting_price: 350, description: 'Starting rate for families. Duration and image count based on group size.' },
      { name: 'Newborn Session',                  category: 'Newborn',          pricing_mode: 'fixed',     sell_price: 450, description: 'In-home or studio. 2-hour session with safety posing. 50 edited images.' },
      { name: 'Engagement Session',               category: 'Couples',          pricing_mode: 'fixed',     sell_price: 395, description: '90-minute session. 2 locations. 50 edited images. Print release included.' },
      { name: 'Headshot — Single',                category: 'Business / Brand', pricing_mode: 'fixed',     sell_price: 175, description: '30-minute session. 2 wardrobe changes. 10 edited images.' },
      { name: 'Brand Session — Half Day',         category: 'Business / Brand', pricing_mode: 'quote',                       description: 'Half-day brand content shoot. Quoted by scope and deliverables.' },
      { name: 'Real Estate Photography',          category: 'Real Estate',      pricing_mode: 'starts_at', starting_price: 195, description: 'Interior and exterior. Starting rate by square footage.' },
      { name: 'Add-On: Print Package',            category: 'Add-Ons',          pricing_mode: 'starts_at', starting_price: 75,  description: 'Printed products from your session. Pricing based on selection.' },
    ],
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'All bookings require a consultation call before confirmation. Deposits required to hold dates.',
    },
    products: [
      { name: 'Event Coordination — Day-Of',      category: 'Coordination',    pricing_mode: 'starts_at', starting_price: 595, description: 'Day-of coordination for events up to 100 guests. Starting rate.' },
      { name: 'Event Planning — Full Service',    category: 'Coordination',    pricing_mode: 'quote',                           description: 'Full planning from concept to execution. Quoted by scope and guest count.' },
      { name: 'Venue Setup & Teardown',           category: 'Setup Services',  pricing_mode: 'starts_at', starting_price: 295, description: 'Decorating, layout setup, and teardown crew. Starting rate by venue size.' },
      { name: 'Floral Arrangement — Table',       category: 'Florals',         pricing_mode: 'starts_at', starting_price: 65,  description: 'Per centerpiece or table arrangement. Custom quoted for full orders.' },
      { name: 'Floral Package — Full Event',      category: 'Florals',         pricing_mode: 'quote',                           description: 'All florals for an event. Quoted by count and flower selection.' },
      { name: 'Photo Booth Rental — 3 hrs',       category: 'Entertainment',   pricing_mode: 'fixed',     sell_price: 495,     description: 'Backdrop, props, unlimited prints. Setup and attendant included.' },
      { name: 'Catering Coordination',            category: 'Catering',        pricing_mode: 'quote',                           description: 'Vendor sourcing, menu planning, and day-of catering management.' },
      { name: 'DJ / Music Coordination',          category: 'Entertainment',   pricing_mode: 'starts_at', starting_price: 450, description: 'Music and MC for up to 4 hours. Equipment and setup included.' },
      { name: 'Rental: Tables & Chairs (per 10)', category: 'Rentals',         pricing_mode: 'fixed',     sell_price: 120,     description: '10 chairs and 1 table. Delivery, setup, and pickup included.' },
      { name: 'Rental: Linens Package',           category: 'Rentals',         pricing_mode: 'starts_at', starting_price: 85,  description: 'Table linens, napkins, and runners. Quoted by table count and color.' },
    ],
  },

  // ── Bakery / Food ──────────────────────────────────────────────────────────
  bakery: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Custom orders require at least 5 days notice. Wedding and event cakes require 4 weeks notice.',
    },
    products: [
      { name: 'Custom Cake — 6 inch (serves 8–10)',   category: 'Custom Cakes',    pricing_mode: 'starts_at', starting_price: 55,  description: '2-layer custom design. Starting price; flavor and decoration affect final price.' },
      { name: 'Custom Cake — 8 inch (serves 12–16)',  category: 'Custom Cakes',    pricing_mode: 'starts_at', starting_price: 75,  description: '2-layer custom design. Flavor and decoration affect final price.' },
      { name: 'Custom Cake — Tiered / Wedding',       category: 'Custom Cakes',    pricing_mode: 'quote',                           description: 'Multi-tier or wedding cakes. Quoted based on tiers, servings, and design.' },
      { name: 'Cupcakes — Dozen',                     category: 'Cupcakes',        pricing_mode: 'fixed',     sell_price: 36,       description: '12 cupcakes. Standard flavors. Custom frosting available.' },
      { name: 'Cupcakes — Half Dozen',                category: 'Cupcakes',        pricing_mode: 'fixed',     sell_price: 20,       description: '6 cupcakes. Standard flavors.' },
      { name: 'Cookies — Dozen',                      category: 'Cookies',         pricing_mode: 'fixed',     sell_price: 28,       description: 'Assorted or single-flavor cookies. Decorated options available.' },
      { name: 'Loaf Bread',                           category: 'Breads',          pricing_mode: 'fixed',     sell_price: 12,       description: 'Sourdough, whole wheat, or seasonal. Baked fresh to order.' },
      { name: 'Muffins — Half Dozen',                 category: 'Pastries',        pricing_mode: 'fixed',     sell_price: 18,       description: 'Seasonal flavors. Baked fresh.' },
      { name: 'Cookie Decorating Kit',                category: 'Kits',            pricing_mode: 'fixed',     sell_price: 32,       description: 'Pre-baked cookies, frosting, and sprinkles for at-home decorating.' },
      { name: 'Dessert Platter — Small',              category: 'Platters',        pricing_mode: 'starts_at', starting_price: 45,  description: 'Assorted baked goods for events or gifting. Starting rate.' },
      { name: 'Dessert Platter — Large',              category: 'Platters',        pricing_mode: 'starts_at', starting_price: 85,  description: 'Full event platter. Selection and quantity quoted.' },
    ],
  },

  // ── Property Maintenance ───────────────────────────────────────────────────
  property_maintenance: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'Emergency work orders receive priority response. Please indicate urgency when submitting.',
    },
    products: [
      { name: 'Emergency Work Order',              category: 'Emergency',         pricing_mode: 'starts_at', starting_price: 150, description: '4-hour response for water, electrical, and security issues.' },
      { name: 'Handyman — 1 Hour',                 category: 'Handyman',          pricing_mode: 'fixed',     sell_price: 85,      description: 'One technician, one hour. Small repairs and punch list items.' },
      { name: 'Handyman — Half Day (4 hrs)',        category: 'Handyman',          pricing_mode: 'fixed',     sell_price: 300,     description: '4-hour block for multi-item punch lists.' },
      { name: 'Painting — Touch-Up',               category: 'Interior Work',     pricing_mode: 'starts_at', starting_price: 85,  description: 'Wall touch-up or single accent wall. Starting per area.' },
      { name: 'Painting — Full Room',              category: 'Interior Work',     pricing_mode: 'starts_at', starting_price: 225, description: 'Single room, 2 coats. Paint included.' },
      { name: 'Drywall Repair — Patch',            category: 'Interior Work',     pricing_mode: 'starts_at', starting_price: 85,  description: 'Small to medium hole. Tape, mud, sand, and prime.' },
      { name: 'Door / Lock Service',               category: 'General Repairs',   pricing_mode: 'starts_at', starting_price: 75,  description: 'Adjust, rekey, or replace. Hardware cost separate.' },
      { name: 'Caulking & Sealing',                category: 'General Repairs',   pricing_mode: 'starts_at', starting_price: 65,  description: 'Bath, kitchen, or exterior caulk and seal.' },
      { name: 'Gutter Cleaning',                   category: 'Exterior',          pricing_mode: 'fixed',     sell_price: 125,     description: 'Single-story residential. Includes downspout flush.' },
      { name: 'Unit Turnover Package',             category: 'Turnover',          pricing_mode: 'quote',                           description: 'Full make-ready. Clean, paint touch, repairs, checklist. Quoted by unit size and condition.' },
      { name: 'Property Inspection Report',        category: 'Inspection',        pricing_mode: 'fixed',     sell_price: 95,      description: 'Walk-through inspection with documented findings and deficiency report.' },
    ],
  },

  // ── Contractor / Construction ──────────────────────────────────────────────
  contractor: {
    site_settings: {
      order_flow    : 'request',
      currency      : 'USD',
      schedule_notes: 'All projects begin with an in-person estimate. Please describe your project in detail when submitting.',
    },
    products: [
      { name: 'Project Estimate / Consultation', category: 'Estimating',       pricing_mode: 'fixed',     sell_price: 0,   description: 'Free in-home estimate. Detailed written quote provided after walkthrough.' },
      { name: 'Deck Build — New',                category: 'Decks & Outdoor',  pricing_mode: 'quote',                      description: 'Design, materials, and labor. Quoted after site visit and measurements.' },
      { name: 'Deck Repair / Restoration',       category: 'Decks & Outdoor',  pricing_mode: 'starts_at', starting_price: 350, description: 'Board replacement, railing repair, or stain. Starting rate.' },
      { name: 'Fence Install',                   category: 'Fencing',          pricing_mode: 'quote',                      description: 'Wood, vinyl, or chain link. Quoted by linear footage and material.' },
      { name: 'Fence Repair',                    category: 'Fencing',          pricing_mode: 'starts_at', starting_price: 195, description: 'Post, panel, or gate repair. Starting rate.' },
      { name: 'Framing & Drywall',               category: 'Interior Finish',  pricing_mode: 'quote',                      description: 'New walls, room additions, or basement finish. Always quoted.' },
      { name: 'Flooring Install — LVP / Laminate', category: 'Flooring',       pricing_mode: 'starts_at', starting_price: 2.50, description: 'Per square foot installed. Material cost separate or included.' },
      { name: 'Tile Install',                    category: 'Flooring',         pricing_mode: 'starts_at', starting_price: 6,   description: 'Per square foot. Substrate prep included. Tile cost separate.' },
      { name: 'Bathroom Remodel',                category: 'Remodeling',       pricing_mode: 'quote',                      description: 'Full or partial remodel. Quoted after design and measurement walkthrough.' },
      { name: 'Kitchen Remodel',                 category: 'Remodeling',       pricing_mode: 'quote',                      description: 'Cabinet, countertop, and layout work. Always quoted in person.' },
      { name: 'Concrete Work',                   category: 'Concrete',         pricing_mode: 'quote',                      description: 'Patio, driveway, sidewalk, or steps. Quoted by area and design.' },
    ],
  },

};

// ── Key aliases — map join.html chip values to template keys ─────────────────
// join.html uses: bakery, contractor, lawn_care, cleaning, photography,
//                 pet_services, events, handyman, other
// We also accept hvac, plumbing, property_maintenance from direct API calls.

const ALIASES = {
  bakery              : 'bakery',
  'bakery/food'       : 'bakery',
  food                : 'bakery',
  contractor          : 'contractor',
  lawn_care           : 'lawn_care',
  lawn                : 'lawn_care',
  landscaping         : 'lawn_care',
  cleaning            : 'cleaning',
  photography         : 'photography',
  pet_services        : 'pet_services',
  pets                : 'pet_services',
  events              : 'events',
  event_planning      : 'events',
  handyman            : 'handyman',
  hvac                : 'hvac',
  plumbing            : 'plumbing',
  property_maintenance: 'property_maintenance',
  pressure_washing    : 'pressure_washing',
  restoration         : 'property_maintenance',
  facility_maintenance: 'property_maintenance',
  default             : 'handyman',  // fallback to handyman as a neutral starting point
  other               : null,        // 'other' gets no seeded products — blank slate
};

function resolveTemplateKey(raw) {
  const key = String(raw || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (key in ALIASES) return ALIASES[key];
  if (key in TEMPLATES) return key;
  return null; // no template — blank slate
}

// ── Main export ───────────────────────────────────────────────────────────────

async function seedTemplateForTenant(supabase, tenantId, operatorId, seedTemplateKey) {
  const templateKey = resolveTemplateKey(seedTemplateKey);

  // ── 1. Upsert site_settings in tenant_config ─────────────────────────────
  const template   = templateKey ? TEMPLATES[templateKey] : null;
  const siteConfig = template?.site_settings || {};

  const { error: configError } = await supabase
    .from('tenant_config')
    .upsert([{
      tenant_id   : tenantId,
      config_key  : 'site_settings',
      config_value: JSON.stringify({
        theme         : 'light',
        currency      : siteConfig.currency      || 'USD',
        order_flow    : siteConfig.order_flow     || 'request',
        template      : templateKey              || 'default',
        schedule_notes: siteConfig.schedule_notes || '',
        setup_complete: false,
        launched      : false,
      }),
    }], { onConflict: 'tenant_id,config_key' });

  if (configError) {
    console.warn('[seed-templates] tenant_config upsert non-fatal:', configError.message);
  }

  // ── 2. Seed products if a matching template exists ────────────────────────
  if (!template?.products?.length) {
    console.log(`[seed-templates] No products to seed for key="${seedTemplateKey}" (resolved="${templateKey}")`);
    return { seeded: 0, templateKey };
  }

  // Check whether this tenant already has products — don't double-seed
  const { data: existing, error: checkError } = await supabase
    .from('products')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1);

  if (checkError) {
    console.warn('[seed-templates] products check non-fatal:', checkError.message);
  }

  if (existing && existing.length > 0) {
    console.log(`[seed-templates] Tenant ${tenantId} already has products — skipping seed.`);
    return { seeded: 0, skipped: true, templateKey };
  }

  // Build the product rows
  const rows = template.products.map((def, i) =>
    buildProduct(tenantId, operatorId, (i + 1) * 10, def)
  );

  const { error: insertError } = await supabase
    .from('products')
    .insert(rows);

  if (insertError) {
    // Non-fatal — tenant can add products manually
    console.warn('[seed-templates] products insert non-fatal:', insertError.message);
    return { seeded: 0, error: insertError.message, templateKey };
  }

  console.log(`[seed-templates] Seeded ${rows.length} products for tenant ${tenantId} (template="${templateKey}")`);
  return { seeded: rows.length, templateKey };
}

module.exports = { seedTemplateForTenant, TEMPLATES, resolveTemplateKey };
