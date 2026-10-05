/**
 * @file appraisalTemplates.js
 * @description Enterprise-grade Appraisal Cycle and Performance Review seed templates
 * covering all departments, review statuses, 360 peer feedback, and scoring parameters
 * for past years (2024 and 2025).
 */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const DEFAULT_PARAMETERS = [
  { name: 'Technical Skills', order: 1 },
  { name: 'Conduct & Ethics', order: 2 },
  { name: 'Punctuality & Attendance', order: 3 },
  { name: 'Communication', order: 4 },
  { name: 'Teamwork & Collaboration', order: 5 },
];

export const DEPARTMENT_APPRAISAL_CONTENT = {
  Engineering: {
    accomplishments: [
      'Successfully architected monolithic service decomposition, deployed Kong API Gateway with JWT verification, and maintained 99.98% backend uptime.',
      'Built automated CI/CD deployment pipelines with zero-downtime rolling updates and integrated automated end-to-end Playwright test suites.',
      'Optimized database connection pooling with PgBouncer and indexed high-frequency queries, reducing p95 API response times from 180ms to 42ms.',
      'Delivered core authentication service decoupling into standalone microservice with Redis session caching, eliminating user token invalidation bugs.',
    ],
    weaknesses: [
      'Looking to deepen hands-on expertise in distributed event-driven streaming with Kafka and enhance system architecture documentation.',
      'Seeking to improve delegation of sprint deliverables to junior developers to allocate more time to long-term architectural planning.',
      'Aiming to contribute more proactive technical talks and cross-team knowledge transfers on modern cloud patterns.',
    ],
    managerRemarks: [
      'Exceptional engineering execution throughout this cycle. Consistently produces high-quality, production-ready code and leads by example during high-severity production triage.',
      'Demonstrated stellar technical acumen in stabilizing core backend APIs. Communicates effectively across cross-functional teams and proactively addresses technical debt.',
      'A cornerstone contributor to our engineering velocity. Handled complex refactoring smoothly with zero customer-facing downtime. Highly recommended for senior career ladder.',
    ],
    peerStrengths: [
      'Outstanding technical problem-solver who is always willing to pair program and debug complex production incidents.',
      'Great team player who writes remarkably clean, readable code and provides thorough, constructive pull request reviews.',
      'Invaluable mentor during onboarding; always takes time to clarify system domain boundaries and test patterns.',
    ],
    peerGrowthAreas: [
      'Could share more internal tech talks on distributed systems best practices to elevate newer team members.',
      'Sometimes takes on too many critical path tasks simultaneously instead of distributing the load.',
      'Encouraged to contribute more actively in product refinement discussions beyond pure engineering considerations.',
    ],
  },

  IT: {
    accomplishments: [
      'Consolidated multi-forest Active Directory to Azure AD/Entra ID, enforcing universal single sign-on across 25 corporate SaaS applications.',
      'Hardened enterprise endpoint security with CrowdStrike EDR agents and automated zero-day vulnerability patch deployment across all workstations.',
      'Configured high-availability PostgreSQL replica failover with automated point-in-time recovery testing, achieving RTO under 5 minutes.',
      'Deployed self-service password reset (SSPR) portal and ticket triage bots, cutting IT helpdesk ticket resolution time by 42%.',
    ],
    weaknesses: [
      'Seeking to attain AWS Solutions Architect Professional certification to lead upcoming cloud disaster recovery drills.',
      'Working on refining automated inventory asset tracking scripts for physical hardware peripherals.',
      'Looking to formalize scheduled quarterly cyber-security phishing simulation drills for all employees.',
    ],
    managerRemarks: [
      'Exemplary dependability and proactive infrastructure management. Completed directory consolidation on schedule without employee disruption.',
      'Strong domain expertise in security posture and cloud access control. Shows excellent customer service ethos when assisting department heads.',
      'Consistently ensures 100% compliance across access governance audits and SOC2 readiness checklists. A true IT pillar.',
    ],
    peerStrengths: [
      'Extremely responsive whenever emergency infrastructure support or VPN access credentials are required.',
      'Approachable, patient, and resolves IT system glitches with clear explanations.',
      'Proactive in notifying team members about upcoming software maintenance windows and patches.',
    ],
    peerGrowthAreas: [
      'Could publish brief self-help video guides in the Company Hub for common VPN and printer setup issues.',
      'Encouraged to streamline hardware replacement turnaround times for remote colleagues.',
    ],
  },

  Operations: {
    accomplishments: [
      'Standardized Tier-1 through Tier-3 operational incident escalation trees and integrated PagerDuty automated alerts, slashing MTTR by 45%.',
      'Automated vendor invoice tracking and service level agreement (SLA) penalty reconciliation, saving an estimated 12% in annual operational overhead.',
      'Conducted quarterly blameless post-mortem reviews and implemented corrective preventive action tracking across cross-departmental handoffs.',
      'Published comprehensive Standard Operating Procedures (SOP) repository in Company Hub, reducing new associate onboarding time by 3 weeks.',
    ],
    weaknesses: [
      'Aiming to develop advanced data visualization dashboards in Tableau/PowerBI for real-time queue capacity modeling.',
      'Working on balancing immediate operational fire-fighting with strategic long-term vendor negotiations.',
      'Looking to participate in Six Sigma Green Belt training to spearhead process defect reduction initiatives.',
    ],
    managerRemarks: [
      'Outstanding organizational drive and discipline. Has brought clarity, predictability, and rigour to our daily operational pipelines.',
      'Instrumental in managing critical vendor negotiations and ensuring strict SLA adherence. Respected cross-functionally for transparency.',
      'Demonstrated superior calm and methodical problem-solving during multi-departmental workflow escalations. Top-tier performer.',
    ],
    peerStrengths: [
      'Brings extraordinary structure and clarity to chaotic, fast-moving cross-team operational initiatives.',
      'Always follows up on action items and holds stakeholders accountable with professional diplomacy.',
      'Great communicator who ensures everyone understands operational handoff expectations.',
    ],
    peerGrowthAreas: [
      'Could automate recurring manual spreadsheet reports to free up bandwidth for higher-leverage process redesign.',
      'Encouraged to schedule operational review meetings with longer advance notice for engineering teams.',
    ],
  },

  HR: {
    accomplishments: [
      'Led seamless HRIS platform migration, digitizing 100% of employee personnel files into encrypted vault storage with role-based access.',
      'Conducted annual statutory PF, ESI, and gratuity contribution audit with external consultants, achieving zero non-compliance findings.',
      'Designed and rolled out standardized competency career ladders and compensation benchmark bands across all business units.',
      'Organized mandatory POSH annual awareness certifications for 100% of workforce and facilitated quarterly wellbeing pulse surveys.',
    ],
    weaknesses: [
      'Focusing on building advanced predictive turnover analytics to anticipate attrition risks in critical technical talent.',
      'Seeking to enhance employer branding initiatives on professional networks to boost direct applicant pipeline.',
      'Working on automating employee exit clearance handoffs between IT, Finance, and HR departments.',
    ],
    managerRemarks: [
      'Exceptional empathy, professionalism, and thoroughness in managing human capital operations. Completed statutory audits flawlessly.',
      'Spearheaded the career ladder initiative with outstanding cross-departmental buy-in from all leadership teams.',
      'Highly trusted partner for executive leadership on employee engagement, retention strategies, and talent growth.',
    ],
    peerStrengths: [
      'Genuinely cares for employee wellbeing; approachable, empathetic, and always transparent with policy questions.',
      'Made onboarding incredibly smooth and welcoming, explaining statutory forms clearly and promptly.',
      'Fair, objective, and handles sensitive workplace queries with consummate discretion.',
    ],
    peerGrowthAreas: [
      'Could accelerate turnaround times for employment verification letter requests through self-service templates.',
      'Encouraged to organize more informal cross-departmental coffee chats to nurture inter-team bonds.',
    ],
  },

  Finance: {
    accomplishments: [
      'Successfully completed multi-year historical ERP general ledger migration with zero opening trial balance discrepancy.',
      'Automated multi-currency Forex realized and unrealized gain/loss postings with real-time RBI exchange rate feed integration.',
      'Strengthened Internal Financial Controls (IFC) by enforcing segregation of duties and maker-checker approval workflows in payment portals.',
      'Coordinated comprehensive statutory audit and transfer pricing Form 3CEB filings with zero audit qualifications from external auditors.',
    ],
    weaknesses: [
      'Working on accelerating monthly financial book closing timeline from 8 business days down to 4 business days.',
      'Seeking to master automated financial forecasting models and capital expenditure scenario analyses.',
      'Looking to conduct quarterly tax optimization reviews with external cross-border taxation specialists.',
    ],
    managerRemarks: [
      'Demonstrated impeccable financial precision, integrity, and analytical depth throughout all closing and audit cycles.',
      'Led the ERP general ledger transition flawlessly under aggressive statutory deadlines. Commended by external audit partners.',
      'Strategic thinker who consistently identifies fiscal leakage risks and recommends practical cost-rationalization measures.',
    ],
    peerStrengths: [
      'Always prompt and accurate when processing team expense reimbursements and travel claims.',
      'Explains budgeting guidelines and statutory invoice requirements patiently and clearly.',
      'Exceptionally dependable numbers partner during quarterly budget planning sessions.',
    ],
    peerGrowthAreas: [
      'Could introduce a monthly finance FAQ newsletter to clarify tax declaration and bill submission deadlines.',
      'Encouraged to provide earlier visibility into department spend vs forecast ahead of quarter-end.',
    ],
  },
};
