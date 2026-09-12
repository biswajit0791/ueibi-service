import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const SAMPLE_EVENTS = [
  {
    title: "Annual Tech Summit & AI Hackathon 2026",
    date: "September 22, 2026",
    time: "09:30 AM",
    location: "Innovation Lab & Virtual Hall",
    description: "48-hour internal hackathon focusing on AI agents, enterprise automation, and customer experience. Mentors and prizes for top teams!",
    isFeatured: true,
  },
  {
    title: "Q3 Executive All-Hands & Strategy Town Hall",
    date: "September 28, 2026",
    time: "04:00 PM",
    location: "Main Auditorium & Zoom Livestream",
    description: "Join our CMD and leadership council for Q3 performance reviews, global expansion updates, and an open AMA session.",
    isFeatured: true,
  },
  {
    title: "Wellness Week: Mindfulness & Ergonomics Workshop",
    date: "October 05, 2026",
    time: "11:00 AM",
    location: "Wellness Pavilion & Floor 4 Studio",
    description: "Guided meditation, ergonomic desk posture assessment by physiotherapists, and healthy nutrition consultation for all employees.",
    isFeatured: false,
  },
  {
    title: "Product Engineering Showcase: Next-Gen Architecture",
    date: "October 12, 2026",
    time: "02:00 PM",
    location: "Tech Amphitheater",
    description: "Deep-dive presentations by the core platform team into our microservices transition, real-time message brokers, and security compliance.",
    isFeatured: false,
  },
  {
    title: "Annual Corporate Gala & Excellence Awards Night",
    date: "October 25, 2026",
    time: "07:00 PM",
    location: "Grand Imperial Ballroom",
    description: "Celebrating top achievers, milestone anniversaries, and standout project deliveries with dinner, live band, and awards presentation.",
    isFeatured: true,
  },
  {
    title: "Diversity, Equity & Inclusion Roundtable",
    date: "November 03, 2026",
    time: "03:30 PM",
    location: "Synergy Conference Suite B",
    description: "An interactive community discussion on fostering inclusive leadership, neurodiversity in tech, and cross-cultural mentorship programs.",
    isFeatured: false,
  },
  {
    title: "Cloud Security & Zero-Trust Best Practices",
    date: "November 15, 2026",
    time: "10:30 AM",
    location: "Training Room 3 & Webinar",
    description: "Mandatory annual infosec briefing covering phishing prevention, token hygiene, secret management, and incident escalation protocols.",
    isFeatured: false,
  },
  {
    title: "Winter Sports League & Outdoor Cricket Cup",
    date: "December 06, 2026",
    time: "08:00 AM",
    location: "City Sports Arena",
    description: "Annual inter-departmental cricket and badminton tournaments. Trophies, team jerseys, and food stalls for colleagues and families.",
    isFeatured: true,
  },
];

async function main() {
  console.log('Seeding sample corporate events...');
  const tenants = await prisma.tenant.findMany({
    include: {
      users: {
        where: { role: { in: ['HR', 'MANAGER', 'CMD', 'ADMIN', 'SUPER_ADMIN', 'LEADERSHIP'] } },
        take: 1,
      },
    },
  });

  if (tenants.length === 0) {
    console.log('No tenants found.');
    return;
  }

  for (const tenant of tenants) {
    const creator = tenant.users[0];
    const createdById = creator ? creator.id : 'system';
    const postedBy = creator ? (creator.name || 'Corporate HR') : 'Corporate HR';

    console.log(`Seeding events for tenant: ${tenant.companyName || tenant.id}...`);

    for (const ev of SAMPLE_EVENTS) {
      const id = `ev_${randomUUID()}`;
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "hub_events" 
           ("id", "tenantId", "createdById", "postedBy", "title", "date", "time", "location", "description", "isFeatured", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          id, tenant.id, createdById, postedBy, ev.title, ev.date, ev.time, ev.location, ev.description, ev.isFeatured
        );
      } catch (err) {
        console.error(`Failed inserting ${ev.title}:`, err.message);
      }
    }
    console.log(`Seeded ${SAMPLE_EVENTS.length} events for ${tenant.companyName || tenant.id}.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
