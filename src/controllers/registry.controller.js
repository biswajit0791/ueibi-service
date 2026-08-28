import { prisma } from '../lib/prisma.js';

export async function searchRegistry(req, res, next) {
  try {
    const {
      query,
      name,
      designation,
      birthYear,
      phone,
      linkedin,
      minTech,
      minAttitude,
    } = req.query || {};

    const pansToFetch = new Set();
    const emailsToFetch = new Set();

    // 1. Direct query search (PAN or Email)
    if (query) {
      const q = query.trim().toUpperCase();
      const qLower = q.toLowerCase();

      // Search ExEmployeeRecord
      const exRecs = await prisma.exEmployeeRecord.findMany({
        where: {
          OR: [
            { pan: { equals: q, mode: 'insensitive' } },
            { email: { equals: qLower, mode: 'insensitive' } },
          ],
        },
        select: { pan: true, email: true },
      });
      exRecs.forEach(r => {
        if (r.pan) pansToFetch.add(r.pan.toUpperCase());
        if (r.email) emailsToFetch.add(r.email.toLowerCase());
      });

      // Search NonJoinerRecord
      const offerRecs = await prisma.nonJoinerRecord.findMany({
        where: {
          OR: [
            { pan: { equals: q, mode: 'insensitive' } },
            { email: { equals: qLower, mode: 'insensitive' } },
          ],
        },
        select: { pan: true, email: true },
      });
      offerRecs.forEach(r => {
        if (r.pan) pansToFetch.add(r.pan.toUpperCase());
        if (r.email) emailsToFetch.add(r.email.toLowerCase());
      });

      // Search TenantUser
      const users = await prisma.tenantUser.findMany({
        where: {
          OR: [
            { pan: { equals: q, mode: 'insensitive' } },
            { email: { equals: qLower, mode: 'insensitive' } },
          ],
        },
        select: { pan: true, email: true },
      });
      users.forEach(u => {
        if (u.pan) pansToFetch.add(u.pan.toUpperCase());
        if (u.email) emailsToFetch.add(u.email.toLowerCase());
      });

      // If nothing found, but search term looks like a PAN or Email, let's add it to fetch
      if (pansToFetch.size === 0 && emailsToFetch.size === 0) {
        if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(q)) {
          pansToFetch.add(q);
        } else if (qLower.includes('@')) {
          emailsToFetch.add(qLower);
        }
      }
    } else {
      // 2. Advanced Search Filter
      const exWhere = {};
      const njWhere = {};
      const userWhere = {};

      if (name) {
        const nLower = name.trim().toLowerCase();
        exWhere.OR = [
          { firstName: { contains: nLower, mode: 'insensitive' } },
          { lastName: { contains: nLower, mode: 'insensitive' } },
        ];
        njWhere.OR = [
          { firstName: { contains: nLower, mode: 'insensitive' } },
          { lastName: { contains: nLower, mode: 'insensitive' } },
        ];
        userWhere.name = { contains: nLower, mode: 'insensitive' };
      }

      if (designation) {
        exWhere.designation = { contains: designation, mode: 'insensitive' };
        njWhere.designation = { contains: designation, mode: 'insensitive' };
        userWhere.designation = { contains: designation, mode: 'insensitive' };
      }

      if (birthYear) {
        exWhere.dob = birthYear;
        njWhere.dob = birthYear;
        const start = new Date(`${birthYear}-01-01`);
        const end = new Date(`${birthYear}-12-31`);
        userWhere.dob = { gte: start, lte: end };
      }

      if (phone) {
        exWhere.phone = { contains: phone };
        njWhere.phone = { contains: phone };
        userWhere.phone = { contains: phone };
      }

      // Query ExEmployeeRecords
      const exRecs = await prisma.exEmployeeRecord.findMany({
        where: exWhere,
        select: { pan: true, email: true },
      });
      exRecs.forEach(r => {
        if (r.pan) pansToFetch.add(r.pan.toUpperCase());
        if (r.email) emailsToFetch.add(r.email.toLowerCase());
      });

      // Query NonJoinerRecords
      const offerRecs = await prisma.nonJoinerRecord.findMany({
        where: njWhere,
        select: { pan: true, email: true },
      });
      offerRecs.forEach(r => {
        if (r.pan) pansToFetch.add(r.pan.toUpperCase());
        if (r.email) emailsToFetch.add(r.email.toLowerCase());
      });

      // Query TenantUsers
      const users = await prisma.tenantUser.findMany({
        where: userWhere,
        select: { pan: true, email: true },
      });
      users.forEach(u => {
        if (u.pan) pansToFetch.add(u.pan.toUpperCase());
        if (u.email) emailsToFetch.add(u.email.toLowerCase());
      });
    }

    // Now gather all matching records by those PANs or Emails
    const panList = Array.from(pansToFetch);
    const emailList = Array.from(emailsToFetch);

    if (panList.length === 0 && emailList.length === 0) {
      return res.json([]);
    }

    // Fetch full records
    const [allEx, allOffers, allUsers] = await Promise.all([
      prisma.exEmployeeRecord.findMany({
        where: {
          OR: [
            { pan: { in: panList } },
            { email: { in: emailList } },
          ],
        },
        include: {
          tenant: {
            include: {
              users: {
                where: { role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] } },
                select: { name: true, role: true },
              },
            },
          },
        },
      }),
      prisma.nonJoinerRecord.findMany({
        where: {
          OR: [
            { pan: { in: panList } },
            { email: { in: emailList } },
          ],
        },
        include: {
          tenant: {
            include: {
              users: {
                where: { role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] } },
                select: { name: true, role: true },
              },
            },
          },
        },
      }),
      prisma.tenantUser.findMany({
        where: {
          OR: [
            { pan: { in: panList } },
            { email: { in: emailList } },
          ],
        },
        include: {
          exReviews: {
            where: { status: 'COMPLETED' },
          },
        },
      }),
    ]);

    // Group everything by PAN (or Email if PAN is missing)
    const candidateMap = new Map();

    const getCandidateKey = (item) => {
      return (item.pan || '').trim().toUpperCase() || (item.email || '').trim().toLowerCase();
    };

    const getOrCreateCandidate = (key, baseItem) => {
      if (!candidateMap.has(key)) {
        const nameParts = (baseItem.firstName || baseItem.name || 'Unknown Candidate').split(/\s+/);
        const fname = baseItem.firstName || nameParts[0] || 'Unknown';
        const lname = baseItem.lastName || nameParts.slice(1).join(' ') || '';

        candidateMap.set(key, {
          id: 'cand_' + key.replace(/[^a-zA-Z0-9]/g, '_'),
          fname: fname,
          lname: lname || ' ',
          email: baseItem.email || '',
          pan: baseItem.pan || '',
          phone: baseItem.phone || 'N/A',
          dob: baseItem.dob || '1995',
          industry: baseItem.department || 'Technology',
          skills: 'Engineering, Performance, Registry Verified',
          linkedin: 'linkedin.com/in/' + fname.toLowerCase(),
          reviews: [],
        });
      }
      return candidateMap.get(key);
    };

    // 1. Process ExEmployeeRecords
    allEx.forEach(r => {
      const key = getCandidateKey(r);
      const cand = getOrCreateCandidate(key, r);
      
      const hrContacts = r.tenant.users.map(u => `${u.name} (${u.role})`);

      cand.reviews.push({
        id: r.id,
        company_name: r.tenant.companyName,
        company_logo: null,
        employee_designation: r.designation,
        service_start: r.serviceStart.toISOString().split('T')[0],
        service_end: r.serviceEnd.toISOString().split('T')[0],
        feedback: r.feedback,
        technical_rating: r.techRating,
        professional_rating: r.attitudeRating,
        conduct_level_name: r.conductValue + ' Conduct',
        conduct_value: r.conductValue,
        offer_letter: false,
        hrContacts: hrContacts.length > 0 ? hrContacts : ['HR Operations'],
      });
    });

    // 2. Process NonJoinerRecords
    allOffers.forEach(r => {
      const key = getCandidateKey(r);
      const cand = getOrCreateCandidate(key, r);

      const hrContacts = r.tenant.users.map(u => `${u.name} (${u.role})`);

      cand.reviews.push({
        id: r.id,
        company_name: r.tenant.companyName,
        company_logo: null,
        employee_designation: r.designation,
        service_start: null,
        service_end: null,
        date_of_joining: r.dateOfJoining.toISOString().split('T')[0],
        date_of_joininng: r.dateOfJoining.toISOString().split('T')[0],
        feedback: r.feedback,
        technical_rating: null,
        professional_rating: null,
        conduct_level_name: 'Non-Joiner',
        conduct_value: 'Low',
        offer_letter: true,
        hrContacts: hrContacts.length > 0 ? hrContacts : ['HR Operations'],
      });
    });

    // 3. Process TenantUsers and their completed ExEmployerReviews
    allUsers.forEach(u => {
      const key = getCandidateKey(u);
      const cand = getOrCreateCandidate(key, u);
      
      cand.fname = u.name.split(/\s+/)[0] || cand.fname;
      cand.lname = u.name.split(/\s+/).slice(1).join(' ') || cand.lname;
      if (u.phone) cand.phone = u.phone;
      if (u.dob) cand.dob = u.dob.toISOString().split('-')[0];

      u.exReviews.forEach(rev => {
        cand.reviews.push({
          id: rev.id,
          company_name: rev.exCompany,
          company_logo: null,
          employee_designation: u.designation || 'Former Employee',
          service_start: null,
          service_end: null,
          feedback: rev.feedback,
          technical_rating: rev.rating ? Math.round(Number(rev.rating) * 2) : 8,
          professional_rating: rev.rating ? Math.round(Number(rev.rating) * 2) : 8,
          conduct_level_name: Number(rev.rating) >= 4 ? 'Excellent Conduct' : 'Good Conduct',
          conduct_value: Number(rev.rating) >= 4 ? 'Excellent' : 'Good',
          offer_letter: false,
          hrContacts: [`${rev.exManagerName} (Ex-Manager)`],
        });
      });
    });

    // Filter by Min Tech / Min Attitude on candidate compiled reviews
    let candidatesList = Array.from(candidateMap.values());
    if (minTech || minAttitude) {
      const minT = parseInt(minTech, 10) || 0;
      const minA = parseInt(minAttitude, 10) || 0;

      candidatesList = candidatesList.filter(cand => {
        return cand.reviews.some(r => {
          const t = r.technical_rating !== null ? r.technical_rating : 0;
          const a = r.professional_rating !== null ? r.professional_rating : 0;
          return t >= minT && a >= minA;
        });
      });
    }

    res.json(candidatesList);
  } catch (err) {
    next(err);
  }
}
