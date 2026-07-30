// Mayvel Organization Chart - Mapped from company FigJam diagram
// Auto-layout helper
const N = (id, name, orgRole, dept, x, y) => ({ id, name, orgRole, department: dept, x, y, w: 160, h: 72 });
const E = (from, to) => ({ id: `e_${from}_${to}`, from, to });

const nodes = [
  // ═══════ ROOT ═══════
  N('ceo', 'Akbar', 'CEO', 'Mayvel', 1200, 50),

  // ═══════ LEVEL 1 - CEO Direct Reports ═══════
  N('infra',   'Ravi',  'Director', 'IT/Infra',           80,  200),
  N('hr',      'Divya', 'Director', 'HR/PMO',             320, 200),
  N('finance', 'Finance','Director','Finance',             560, 200),
  N('sales',   'Elwin', 'Director', 'Sales & Marketing',  820, 200),
  N('cto',     'Thaha', 'CTO',     '',                    1100,200),
  N('product', 'Vinod', 'Director', 'Product',             1400,200),
  N('designh', 'Laks',  'Director', 'Design',              2100,200),

  // ═══════ UNDER IT/INFRA (Ravi) ═══════
  N('chandru',  'Chandru',  'Lead',   'Reflect Security',        10,  340),
  N('vishwath', 'Vishwath', 'Lead',   'System Infrastructure',   180, 340),

  // ═══════ UNDER HR/PMO (Divya) ═══════
  N('lathapriyal','Lathapriyal','Consultant','HR Consultant',     250, 340),
  N('sivanesh',   'Sivanesh',  'Manager',   'HR Operations',     420, 340),
  N('ashwin',     'Ashwin',    'Member',    'HR',                 340, 470),
  N('hemapreethi','Hema Preethi','Member',  'Bookkeeper',         340, 590),

  // ═══════ UNDER FINANCE ═══════
  N('sankala', 'Sankalanaman','Manager','Account Manager',        500, 340),
  N('premkhan','Premkhan',   'Manager','IT Accounts Manager',    670, 340),

  // ═══════ UNDER SALES & MARKETING (Elwin) ═══════
  N('pooja',  'Pooja',  'Manager','BD Manager',                  770, 340),
  N('sachin', 'Sachin', 'Member', '',                             940, 340),

  // ═══════ UNDER CTO (Thaha) ═══════
  N('saiyu',   'Saiyu',         'Lead',     '',                  1050, 340),
  N('fireins', 'Fire Inspector','Member',   '',                  1220, 340),
  // Under Saiyu
  N('illan',   'Illan',  'Lead',     'Product Owner',            950,  480),
  // Under Illan
  N('karthick','Karthick','Developer','Sr. Developer',           840,  620),
  N('selva',   'Selva',   'Lead',     'Product Enthusiast',      1020, 620),
  N('manikan', 'Manikandan','Manager','Project Owner',           1200, 620),
  // Under Karthick
  N('karthika','Karthika','Developer','Sr. Developer',           840,  760),
  // Under Selva
  N('ramesh',  'Rameshkumar','Developer','Associate Developer',  940,  760),
  N('alinoor', 'Ali Noorudeen','Developer','Jr. Developer',      1120, 760),
  // Under Manikandan
  N('sharun',  'Sharun BK','Developer','Trainee Developer',      1200, 760),

  // ═══════ UNDER PRODUCT (Vinod) - Right Section ═══════
  N('ragav',   'Ragavendran','Intern',    'Offsite',             2100, 340),
  N('vijmoor', 'Vijay Moorthy','Lead',    'Sales Lead',         1650, 340),
  N('daniel',  'Daniel',     'Lead',      'PM Leader',           1810, 340),
  N('ashish',  'Ashish',     'Lead',      'PMV Leader',          1970, 340),
  N('vigmag',  'Vignesh',    'Developer', 'SW Magto / Dev Work', 2260, 340),
  N('arunkum', 'Arunkumar',  'Developer', 'Sr. SW Developer',    1650, 470),
  N('sharon',  'Sharon',     'Developer', 'Jr. SW Developer',    1810, 470),
  N('harikum', 'Harikumar',  'Designer',  'UD Designer',         1970, 470),
  N('vaishak', 'Vaishak',    'Developer', 'Sr. SW Developer',    2130, 470),
  N('sahesw',  'Saheswari',  'Developer', 'Jr. Developer',       1810, 600),
  N('sreevid', 'SreeVidhya', 'Developer', 'Jr. Developer',       1980, 600),
  N('satheesk','Satheesk',   'Developer', 'Business Developer',  2150, 600),

  // ═══════ DEPARTMENT TEAMS (Bottom Section) ═══════
  // Department headers (y=920)
  N('d_design',  'Design',   'Manager', 'Department',            80,  920),
  N('d_mys',     'MYS',      'Manager', 'Department',            380, 920),
  N('d_audit',   'Audition',  'Manager','Department',            600, 920),
  N('d_soc',     'SOC',       'Manager','Department',            820, 920),
  N('d_corelk',  'Corelk',    'Manager','Department',            980, 920),
  N('d_biratio', 'BIRatio',   'Manager','Department',            1140,920),
  N('d_qa',      'QA',        'Manager','Department',            1380,920),

  // ── Under Design Department ──
  N('vm',       'VM',          'Consultant','UI/UX Consultant',   10,  1060),
  N('naveen_dl','Naveen',      'Lead',      'UI/UX Design Lead',  180, 1060),
  N('joila',   'Joila Pranjith','Lead',     'Sr. UI Coordinator', 10,  1190),
  N('praveenk','Praveenkumar', 'Developer', 'Sr. Software',       190, 1190),
  N('sarvanal','Sarvanalimer', 'Lead',      'Team Lead',          100, 1320),
  N('sathiyan','Sathiyan',     'Developer', 'Software Developer', 10,  1450),
  N('naveen_j','Naveen',       'Developer', 'Jr. Developer',      180, 1450),
  N('harish',  'Harish',       'Developer', 'Jr. Developer',      350, 1450),

  // ── Under MYS ──
  N('mitali',  'Mitali',       'Manager',   'Account Manager',    340, 1060),
  N('silas',   'Silas',        'Member',    '',                   510, 1060),
  N('deva_m',  'Deva',         'Manager',   'Project Manager',    340, 1190),
  N('yogesh',  'Yogesh',       'Developer', 'Software Developer', 420, 1320),
  N('sathisb', 'Sathisanb',    'Developer', 'Software Developer', 510, 1190),

  // ── Under Audition ──
  N('ravi_a',  'Ravi',         'Manager',   'Account Manager',    560, 1060),
  N('thiruma', 'Thirumalarisi','Developer', 'Sr. Developer',      740, 1060),
  N('sarva_a', 'Sarvanalimer', 'Lead',      'Team Lead',          650, 1190),
  N('sathi_a', 'Sathisanb',    'Developer', 'Software Developer', 650, 1320),

  // ── Under SOC ──
  N('thiru_s', 'Thirumalarisi','Developer', 'Sr. Developer',      820, 1060),

  // ── Under Corelk ──
  N('deva_c',  'Deva',         'Manager',   'Project Manager',    980, 1060),

  // ── Under BIRatio ──
  N('ravi_b',  'Ravi',         'Manager',   'Project Manager',    1140,1060),
  N('sureshk', 'Sureshkev',    'Developer', 'Software Developer', 1080,1190),
  N('vigeshr', 'Vigeshkumar',  'Developer', 'Software Developer', 1250,1190),

  // ── Under QA ──
  N('sathjose','Sathis Jose',  'Lead',      'QA Lead',            1340,1060),
  N('sahani',  'Sahani',       'Member',    'QA Trainee',         1510,1060),
];

const edges = [
  // CEO to Level 1
  E('ceo','infra'), E('ceo','hr'), E('ceo','finance'), E('ceo','sales'),
  E('ceo','cto'), E('ceo','product'), E('ceo','designh'),

  // IT/Infra
  E('infra','chandru'), E('infra','vishwath'),

  // HR/PMO
  E('hr','lathapriyal'), E('hr','sivanesh'), E('hr','ashwin'),
  E('ashwin','hemapreethi'),

  // Finance
  E('finance','sankala'), E('finance','premkhan'),

  // Sales
  E('sales','pooja'), E('sales','sachin'),

  // CTO
  E('cto','saiyu'), E('cto','fireins'),
  E('saiyu','illan'),
  E('illan','karthick'), E('illan','selva'), E('illan','manikan'),
  E('karthick','karthika'),
  E('selva','ramesh'), E('selva','alinoor'),
  E('manikan','sharun'),

  // Product (Vinod) right section
  E('designh','ragav'), E('designh','vigmag'),
  E('product','vijmoor'), E('product','daniel'), E('product','ashish'),
  E('vijmoor','arunkum'), E('daniel','sharon'), E('ashish','harikum'),
  E('designh','vaishak'),
  E('sharon','sahesw'), E('harikum','sreevid'), E('vaishak','satheesk'),

  // Department teams
  E('cto','d_design'), E('cto','d_mys'), E('cto','d_audit'),
  E('cto','d_soc'), E('cto','d_corelk'), E('cto','d_biratio'), E('cto','d_qa'),

  // Design dept
  E('d_design','vm'), E('d_design','naveen_dl'),
  E('d_design','joila'), E('d_design','praveenk'),
  E('joila','sarvanal'),
  E('sarvanal','sathiyan'), E('sarvanal','naveen_j'), E('sarvanal','harish'),

  // MYS
  E('d_mys','mitali'), E('d_mys','silas'),
  E('mitali','deva_m'), E('deva_m','yogesh'), E('mitali','sathisb'),

  // Audition
  E('d_audit','ravi_a'), E('d_audit','thiruma'),
  E('ravi_a','sarva_a'), E('sarva_a','sathi_a'),

  // SOC
  E('d_soc','thiru_s'),

  // Corelk
  E('d_corelk','deva_c'),

  // BIRatio
  E('d_biratio','ravi_b'),
  E('ravi_b','sureshk'), E('ravi_b','vigeshr'),

  // QA
  E('d_qa','sathjose'), E('d_qa','sahani'),
];

export const MAYVEL_ORG_CHART = { nodes, edges };
export const CHART_VERSION = 2;
