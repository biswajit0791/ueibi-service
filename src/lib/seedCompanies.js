import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';

export const COMPANIES_SEED_DATA = [
  {
    companyName: '4U SOFTWARE PVT LTD',
    domainName: '4usoftware.com',
    tenantCode: '4USOFTWARE',
    users: [
      // 1. Leadership & Heads
      {
        name: 'Chandra Sekhar Biswal',
        designation: 'CMD',
        role: 'CMD',
        department: 'Executive',
        email: 'chandra.biswal@4usoftware.com',
        reportsToEmail: null,
      },
      {
        name: 'Pravas Ranjan Mohanty',
        designation: 'HR Head',
        role: 'HR',
        department: 'Human Resources',
        email: 'pravas.mohanty@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      {
        name: 'Biswajit Parlakur',
        designation: 'Finance Head',
        role: 'FINANCE',
        department: 'Finance',
        email: 'biswajit.parlakur@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      // Managers
      {
        name: 'Pratik Parida',
        designation: 'Manager - Engineering',
        role: 'MANAGER',
        department: 'Engineering',
        email: 'pratik.parida@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      {
        name: 'Rajesh Behari',
        designation: 'Manager - Technology',
        role: 'MANAGER',
        department: 'Technology',
        email: 'rajesh.behari@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      {
        name: 'Lalit Kumar',
        designation: 'Manager - Product Engineering',
        role: 'MANAGER',
        department: 'Product',
        email: 'lalit.kumar@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      {
        name: 'Nihar Kumar',
        designation: 'Manager - Operations',
        role: 'MANAGER',
        department: 'Operations',
        email: 'nihar.kumar@4usoftware.com',
        reportsToEmail: 'chandra.biswal@4usoftware.com',
      },
      // Employees under Pratik Parida (Engineering)
      {
        name: 'Subham Rout',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'subham.rout@4usoftware.com',
        reportsToEmail: 'pratik.parida@4usoftware.com',
      },
      {
        name: 'Sasmita Pradhan',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'sasmita.pradhan@4usoftware.com',
        reportsToEmail: 'pratik.parida@4usoftware.com',
      },
      {
        name: 'Debasish Sahu',
        designation: 'React Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'debasish.sahu@4usoftware.com',
        reportsToEmail: 'pratik.parida@4usoftware.com',
      },
      {
        name: 'Priyanka Nayak',
        designation: 'UI/UX Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'priyanka.nayak@4usoftware.com',
        reportsToEmail: 'pratik.parida@4usoftware.com',
      },
      {
        name: 'Ashutosh Mishra',
        designation: 'Mobile App Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'ashutosh.mishra@4usoftware.com',
        reportsToEmail: 'pratik.parida@4usoftware.com',
      },
      // Employees under Rajesh Behari (Technology)
      {
        name: 'Soumya Ranjan Das',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'soumya.das@4usoftware.com',
        reportsToEmail: 'rajesh.behari@4usoftware.com',
      },
      {
        name: 'Rakesh Mohapatra',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'rakesh.mohapatra@4usoftware.com',
        reportsToEmail: 'rajesh.behari@4usoftware.com',
      },
      {
        name: 'Ananya Behera',
        designation: 'Java Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'ananya.behera@4usoftware.com',
        reportsToEmail: 'rajesh.behari@4usoftware.com',
      },
      {
        name: 'Abhishek Jena',
        designation: 'Node.js Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'abhishek.jena@4usoftware.com',
        reportsToEmail: 'rajesh.behari@4usoftware.com',
      },
      {
        name: 'Monalisa Swain',
        designation: 'API Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'monalisa.swain@4usoftware.com',
        reportsToEmail: 'rajesh.behari@4usoftware.com',
      },
      // Employees under Lalit Kumar (Product)
      {
        name: 'Biswajit Nayak',
        designation: 'Database Administrator',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'biswajit.nayak@4usoftware.com',
        reportsToEmail: 'lalit.kumar@4usoftware.com',
      },
      {
        name: 'Pritam Pradhan',
        designation: 'PostgreSQL Developer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'pritam.pradhan@4usoftware.com',
        reportsToEmail: 'lalit.kumar@4usoftware.com',
      },
      {
        name: 'Lipika Sahoo',
        designation: 'QA Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'lipika.sahoo@4usoftware.com',
        reportsToEmail: 'lalit.kumar@4usoftware.com',
      },
      {
        name: 'Satyajit Barik',
        designation: 'Automation Test Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'satyajit.barik@4usoftware.com',
        reportsToEmail: 'lalit.kumar@4usoftware.com',
      },
      {
        name: 'Jyoti Ranjan Panda',
        designation: 'Business Analyst',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'jyoti.panda@4usoftware.com',
        reportsToEmail: 'lalit.kumar@4usoftware.com',
      },
      // Employees under Nihar Kumar (Operations)
      {
        name: 'Pradeep Kumar Rout',
        designation: 'DevOps Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'pradeep.rout@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Mamata Mohanty',
        designation: 'Cloud Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'mamata.mohanty@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Soumya Ranjan Patnaik',
        designation: 'System Administrator',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'soumya.patnaik@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Bikash Behera',
        designation: 'Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'bikash.behera@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Rituparna Das',
        designation: 'Technical Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'rituparna.das@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Chinmay Pradhan',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'chinmay.pradhan@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Sweta Mohapatra',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'sweta.mohapatra@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      {
        name: 'Manas Ranjan Jena',
        designation: 'Full Stack Developer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'manas.jena@4usoftware.com',
        reportsToEmail: 'nihar.kumar@4usoftware.com',
      },
      // Executives
      {
        name: 'Sonali Rout',
        designation: 'HR Executive',
        role: 'EMPLOYEE',
        department: 'Human Resources',
        email: 'sonali.rout@4usoftware.com',
        reportsToEmail: 'pravas.mohanty@4usoftware.com',
      },
      {
        name: 'Debendra Sahoo',
        designation: 'Accounts Executive',
        role: 'EMPLOYEE',
        department: 'Finance',
        email: 'debendra.sahoo@4usoftware.com',
        reportsToEmail: 'biswajit.parlakur@4usoftware.com',
      },
    ],
  },
  {
    companyName: 'CITY EXPERT CARE PVT LTD',
    domainName: 'cityexpertcare.com',
    tenantCode: 'CITYEXPERT',
    users: [
      // 1. Leadership & Heads
      {
        name: 'Arindam Mohanty',
        designation: 'CMD',
        role: 'CMD',
        department: 'Executive',
        email: 'arindam.mohanty@cityexpertcare.com',
        reportsToEmail: null,
      },
      {
        name: 'Rashmi Ranjan Das',
        designation: 'HR Head',
        role: 'HR',
        department: 'Human Resources',
        email: 'rashmi.das@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      {
        name: 'Soumya Mohapatra',
        designation: 'Finance Head',
        role: 'FINANCE',
        department: 'Finance',
        email: 'soumya.mohapatra@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      // Managers
      {
        name: 'Anil Kumar Sahoo',
        designation: 'Manager - Engineering',
        role: 'MANAGER',
        department: 'Engineering',
        email: 'anil.sahoo@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      {
        name: 'Debashis Pradhan',
        designation: 'Manager - Technology',
        role: 'MANAGER',
        department: 'Technology',
        email: 'debashis.pradhan@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      {
        name: 'Manas Ranjan Behera',
        designation: 'Manager - Product',
        role: 'MANAGER',
        department: 'Product',
        email: 'manas.behera@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      {
        name: 'Pankaj Kumar Nayak',
        designation: 'Manager - Operations',
        role: 'MANAGER',
        department: 'Operations',
        email: 'pankaj.nayak@cityexpertcare.com',
        reportsToEmail: 'arindam.mohanty@cityexpertcare.com',
      },
      // Employees under Anil Kumar Sahoo (Engineering)
      {
        name: 'Sneha Priyadarshini',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'sneha.priyadarshini@cityexpertcare.com',
        reportsToEmail: 'anil.sahoo@cityexpertcare.com',
      },
      {
        name: 'Rahul Ranjan',
        designation: 'React Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'rahul.ranjan@cityexpertcare.com',
        reportsToEmail: 'anil.sahoo@cityexpertcare.com',
      },
      {
        name: 'Puja Pradhan',
        designation: 'UI/UX Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'puja.pradhan@cityexpertcare.com',
        reportsToEmail: 'anil.sahoo@cityexpertcare.com',
      },
      {
        name: 'Akash Mohanty',
        designation: 'Mobile Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'akash.mohanty@cityexpertcare.com',
        reportsToEmail: 'anil.sahoo@cityexpertcare.com',
      },
      {
        name: 'Smruti Ranjan',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'smruti.ranjan@cityexpertcare.com',
        reportsToEmail: 'anil.sahoo@cityexpertcare.com',
      },
      // Employees under Debashis Pradhan (Technology)
      {
        name: 'Soumya Ranjan Rout',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'soumya.rout@cityexpertcare.com',
        reportsToEmail: 'debashis.pradhan@cityexpertcare.com',
      },
      {
        name: 'Rajendra Pradhan',
        designation: 'Java Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'rajendra.pradhan@cityexpertcare.com',
        reportsToEmail: 'debashis.pradhan@cityexpertcare.com',
      },
      {
        name: 'Ankita Sahoo',
        designation: 'Node.js Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'ankita.sahoo@cityexpertcare.com',
        reportsToEmail: 'debashis.pradhan@cityexpertcare.com',
      },
      {
        name: 'Dibyajyoti Jena',
        designation: 'API Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'dibyajyoti.jena@cityexpertcare.com',
        reportsToEmail: 'debashis.pradhan@cityexpertcare.com',
      },
      {
        name: 'Sushant Kumar',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'sushant.kumar@cityexpertcare.com',
        reportsToEmail: 'debashis.pradhan@cityexpertcare.com',
      },
      // Employees under Manas Ranjan Behera (Product)
      {
        name: 'Kunal Mohapatra',
        designation: 'Database Administrator',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'kunal.mohapatra@cityexpertcare.com',
        reportsToEmail: 'manas.behera@cityexpertcare.com',
      },
      {
        name: 'Rashmi Sahu',
        designation: 'QA Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'rashmi.sahu@cityexpertcare.com',
        reportsToEmail: 'manas.behera@cityexpertcare.com',
      },
      {
        name: 'Tapas Ranjan Das',
        designation: 'Automation Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'tapas.das@cityexpertcare.com',
        reportsToEmail: 'manas.behera@cityexpertcare.com',
      },
      {
        name: 'Barsha Priyadarshini',
        designation: 'Business Analyst',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'barsha.priyadarshini@cityexpertcare.com',
        reportsToEmail: 'manas.behera@cityexpertcare.com',
      },
      {
        name: 'Deepak Behera',
        designation: 'Product Analyst',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'deepak.behera@cityexpertcare.com',
        reportsToEmail: 'manas.behera@cityexpertcare.com',
      },
      // Employees under Pankaj Kumar Nayak (Operations)
      {
        name: 'Nilesh Kumar',
        designation: 'DevOps Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'nilesh.kumar@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Sagar Pradhan',
        designation: 'Cloud Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'sagar.pradhan@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Rakesh Ranjan',
        designation: 'System Administrator',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'rakesh.ranjan@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Jyoti Sahoo',
        designation: 'Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'jyoti.sahoo@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Prakash Mohanty',
        designation: 'Technical Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'prakash.mohanty@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Anupam Das',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'anupam.das@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Debasree Nayak',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'debasree.nayak@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      {
        name: 'Satyam Pradhan',
        designation: 'Full Stack Developer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'satyam.pradhan@cityexpertcare.com',
        reportsToEmail: 'pankaj.nayak@cityexpertcare.com',
      },
      // Executives
      {
        name: 'Rina Mohanty',
        designation: 'HR Executive',
        role: 'EMPLOYEE',
        department: 'Human Resources',
        email: 'rina.mohanty@cityexpertcare.com',
        reportsToEmail: 'rashmi.das@cityexpertcare.com',
      },
      {
        name: 'Gopal Chandra',
        designation: 'Accounts Executive',
        role: 'EMPLOYEE',
        department: 'Finance',
        email: 'gopal.chandra@cityexpertcare.com',
        reportsToEmail: 'soumya.mohapatra@cityexpertcare.com',
      },
    ],
  },
  {
    companyName: 'BLUETELCAST LLC',
    domainName: 'bluetelcast.com',
    tenantCode: 'BLUETEL',
    users: [
      // 1. Leadership & Heads
      {
        name: 'Debendra Kumar Mishra',
        designation: 'CMD',
        role: 'CMD',
        department: 'Executive',
        email: 'debendra.mishra@bluetelcast.com',
        reportsToEmail: null,
      },
      {
        name: 'Namita Ranjan',
        designation: 'HR Head',
        role: 'HR',
        department: 'Human Resources',
        email: 'namita.ranjan@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      {
        name: 'Pranab Kumar Das',
        designation: 'Finance Head',
        role: 'FINANCE',
        department: 'Finance',
        email: 'pranab.das@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      // Managers
      {
        name: 'Ranjan Kumar Behera',
        designation: 'Manager - Engineering',
        role: 'MANAGER',
        department: 'Engineering',
        email: 'ranjan.behera@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      {
        name: 'Soumya Mohan Patnaik',
        designation: 'Manager - Technology',
        role: 'MANAGER',
        department: 'Technology',
        email: 'soumya.patnaik@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      {
        name: 'Sidharth Ranjan',
        designation: 'Manager - Product Engineering',
        role: 'MANAGER',
        department: 'Product',
        email: 'sidharth.ranjan@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      {
        name: 'Bikram Jena',
        designation: 'Manager - Operations',
        role: 'MANAGER',
        department: 'Operations',
        email: 'bikram.jena@bluetelcast.com',
        reportsToEmail: 'debendra.mishra@bluetelcast.com',
      },
      // Employees under Ranjan Kumar Behera (Engineering)
      {
        name: 'Alok Ranjan',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'alok.ranjan@bluetelcast.com',
        reportsToEmail: 'ranjan.behera@bluetelcast.com',
      },
      {
        name: 'Priyanka Das',
        designation: 'React Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'priyanka.das@bluetelcast.com',
        reportsToEmail: 'ranjan.behera@bluetelcast.com',
      },
      {
        name: 'Koushik Pradhan',
        designation: 'Frontend Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'koushik.pradhan@bluetelcast.com',
        reportsToEmail: 'ranjan.behera@bluetelcast.com',
      },
      {
        name: 'Nibedita Mohanty',
        designation: 'UI/UX Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'nibedita.mohanty@bluetelcast.com',
        reportsToEmail: 'ranjan.behera@bluetelcast.com',
      },
      {
        name: 'Abinash Sahoo',
        designation: 'Mobile Developer',
        role: 'EMPLOYEE',
        department: 'Engineering',
        email: 'abinash.sahoo@bluetelcast.com',
        reportsToEmail: 'ranjan.behera@bluetelcast.com',
      },
      // Employees under Soumya Mohan Patnaik (Technology)
      {
        name: 'Satyajit Mohapatra',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'satyajit.mohapatra@bluetelcast.com',
        reportsToEmail: 'soumya.patnaik@bluetelcast.com',
      },
      {
        name: 'Pratik Ranjan',
        designation: 'Java Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'pratik.ranjan@bluetelcast.com',
        reportsToEmail: 'soumya.patnaik@bluetelcast.com',
      },
      {
        name: 'Biswajit Behera',
        designation: 'Node.js Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'biswajit.behera@bluetelcast.com',
        reportsToEmail: 'soumya.patnaik@bluetelcast.com',
      },
      {
        name: 'Sushree Priyadarshini',
        designation: 'API Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'sushree.priyadarshini@bluetelcast.com',
        reportsToEmail: 'soumya.patnaik@bluetelcast.com',
      },
      {
        name: 'Ashish Kumar',
        designation: 'Backend Developer',
        role: 'EMPLOYEE',
        department: 'Technology',
        email: 'ashish.kumar@bluetelcast.com',
        reportsToEmail: 'soumya.patnaik@bluetelcast.com',
      },
      // Employees under Sidharth Ranjan (Product)
      {
        name: 'Manoj Kumar Rout',
        designation: 'Database Administrator',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'manoj.rout@bluetelcast.com',
        reportsToEmail: 'sidharth.ranjan@bluetelcast.com',
      },
      {
        name: 'Laxmi Priya',
        designation: 'QA Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'laxmi.priya@bluetelcast.com',
        reportsToEmail: 'sidharth.ranjan@bluetelcast.com',
      },
      {
        name: 'Prakash Jena',
        designation: 'Automation Engineer',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'prakash.jena@bluetelcast.com',
        reportsToEmail: 'sidharth.ranjan@bluetelcast.com',
      },
      {
        name: 'Mousumi Sahoo',
        designation: 'Business Analyst',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'mousumi.sahoo@bluetelcast.com',
        reportsToEmail: 'sidharth.ranjan@bluetelcast.com',
      },
      {
        name: 'Rakesh Mohapatra',
        designation: 'Product Analyst',
        role: 'EMPLOYEE',
        department: 'Product',
        email: 'rakesh.mohapatra@bluetelcast.com',
        reportsToEmail: 'sidharth.ranjan@bluetelcast.com',
      },
      // Employees under Bikram Jena (Operations)
      {
        name: 'Debasis Nayak',
        designation: 'DevOps Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'debasis.nayak@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Pradeep Mohanty',
        designation: 'Cloud Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'pradeep.mohanty@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Manoj Pradhan',
        designation: 'System Administrator',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'manoj.pradhan@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Subhashree Das',
        designation: 'Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'subhashree.das@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Chinmay Behera',
        designation: 'Technical Support Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'chinmay.behera@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Soumya Ranjan Sahu',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'soumya.sahu@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Ankit Kumar',
        designation: 'Software Engineer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'ankit.kumar@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      {
        name: 'Rajashree Pradhan',
        designation: 'Full Stack Developer',
        role: 'EMPLOYEE',
        department: 'Operations',
        email: 'rajashree.pradhan@bluetelcast.com',
        reportsToEmail: 'bikram.jena@bluetelcast.com',
      },
      // Executives
      {
        name: 'Minati Mohanty',
        designation: 'HR Executive',
        role: 'EMPLOYEE',
        department: 'Human Resources',
        email: 'minati.mohanty@bluetelcast.com',
        reportsToEmail: 'namita.ranjan@bluetelcast.com',
      },
      {
        name: 'Sanjay Kumar Das',
        designation: 'Accounts Executive',
        role: 'EMPLOYEE',
        department: 'Finance',
        email: 'sanjay.das@bluetelcast.com',
        reportsToEmail: 'pranab.das@bluetelcast.com',
      },
    ],
  },
];

/**
 * Idempotently seeds the 3 companies and their employees.
 * Existing records in DB are NEVER deleted.
 * All accounts are provisioned with status ACTIVE, verified, and password "Test@123".
 */
export async function seedThreeCompanies() {
  console.log('\n======================================================');
  console.log(' 🌱 Starting Idempotent Seeding for 3 Companies...');
  console.log('======================================================');

  const defaultPassword = 'Test@123';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  let totalTenantsCreated = 0;
  let totalUsersSeeded = 0;

  for (const comp of COMPANIES_SEED_DATA) {
    console.log(`\n🏢 Processing Company: "${comp.companyName}" (${comp.domainName})...`);

    // 1. Find or create CompanyRegistration
    const cmdUser = comp.users.find((u) => u.role === 'CMD') || comp.users[0];
    const hrUser = comp.users.find((u) => u.role === 'HR') || comp.users[1];
    const financeUser = comp.users.find((u) => u.role === 'FINANCE') || comp.users[2];

    // 1. Find or create CompanyRegistration
    let registration = await prisma.companyRegistration.findFirst({
      where: {
        OR: [
          { domainName: { equals: comp.domainName, mode: 'insensitive' } },
          { tenantCode: { equals: comp.tenantCode, mode: 'insensitive' } },
        ],
      },
    });

    if (!registration) {
      registration = await prisma.companyRegistration.create({
        data: {
          companyName: comp.companyName,
          companyType: 'Private Limited',
          domainName: comp.domainName,
          tenantCode: comp.tenantCode,
          fullName: cmdUser.name,
          designation: cmdUser.designation,
          email: cmdUser.email,
          hrEmail: hrUser?.email || cmdUser.email,
          financeEmail: financeUser?.email || cmdUser.email,
          passwordHash,
          status: 'ACTIVE',
          licenseQuantity: 100,
          acceptedTermsAt: new Date(),
          activatedAt: new Date(),
        },
      });
      console.log(`  ➕ Created CompanyRegistration: ID=${registration.id}`);
    } else {
      registration = await prisma.companyRegistration.update({
        where: { id: registration.id },
        data: {
          companyName: comp.companyName,
          tenantCode: comp.tenantCode,
          email: cmdUser.email,
          hrEmail: hrUser?.email || cmdUser.email,
          financeEmail: financeUser?.email || cmdUser.email,
          status: 'ACTIVE',
        },
      });
      console.log(`  ℹ️ Updated existing CompanyRegistration: ID=${registration.id}`);
    }

    // 2. Find or create Tenant
    let tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { domainName: { equals: comp.domainName, mode: 'insensitive' } },
          { tenantCode: { equals: comp.tenantCode, mode: 'insensitive' } },
          { registrationId: registration.id },
        ],
      },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          companyName: comp.companyName,
          domainName: comp.domainName,
          tenantCode: comp.tenantCode,
          licenseLimit: 100,
          status: 'ACTIVE',
          registrationId: registration.id,
        },
      });
      totalTenantsCreated++;
      console.log(`  ➕ Created Tenant: ID=${tenant.id}, Code=${tenant.tenantCode}`);
    } else {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          status: 'ACTIVE',
          companyName: comp.companyName,
          tenantCode: comp.tenantCode,
          licenseLimit: Math.max(tenant.licenseLimit || 0, 100),
        },
      });
      console.log(`  ℹ️ Updated Tenant: ID=${tenant.id}, Code=${tenant.tenantCode}, Name=${tenant.companyName}`);
    }

    // 3. Ensure TenantSettings exist with standard Financial Year config (April 1)
    let settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: tenant.id },
    });
    if (!settings) {
      await prisma.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          financialYearStartMonth: 4,
          financialYearStartDay: 1,
          milestoneRequireApproval: true,
          milestoneWatcherDomains: [comp.domainName],
        },
      }).catch(() => { });
    }

    // 4. Ensure Departments exist
    const departments = ['Executive', 'Human Resources', 'Finance', 'Engineering', 'Technology', 'Product', 'Operations'];
    for (const deptName of departments) {
      await prisma.department.upsert({
        where: {
          tenantId_name: {
            tenantId: tenant.id,
            name: deptName,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          name: deptName,
        },
      }).catch(() => { });
    }

    // 5. Pass 1: Upsert all users for this tenant
    const emailToUserId = new Map();

    for (const userData of comp.users) {
      const cleanEmail = userData.email.toLowerCase().trim();

      const existingUser = await prisma.tenantUser.findFirst({
        where: {
          email: { equals: cleanEmail, mode: 'insensitive' },
        },
      });

      if (existingUser) {
        // Ensure user is ACTIVE, verified, has latest role, designation, and valid password
        const updated = await prisma.tenantUser.update({
          where: { id: existingUser.id },
          data: {
            tenantId: tenant.id,
            email: cleanEmail,
            name: userData.name,
            role: userData.role,
            designation: userData.designation,
            department: userData.department,
            status: 'ACTIVE',
            isDeleted: false,
            mustChangePassword: false,
            isVerified: true,
            verificationStatus: 'VERIFIED',
            empType: 'PERMANENT',
            passwordHash: existingUser.passwordHash || passwordHash,
          },
        });
        emailToUserId.set(cleanEmail, updated.id);
      } else {
        const created = await prisma.tenantUser.create({
          data: {
            tenantId: tenant.id,
            email: cleanEmail,
            name: userData.name,
            role: userData.role,
            designation: userData.designation,
            department: userData.department,
            passwordHash,
            status: 'ACTIVE',
            isDeleted: false,
            mustChangePassword: false,
            isVerified: true,
            verificationStatus: 'VERIFIED',
            empType: 'PERMANENT',
            joinDate: new Date('2026-01-01'),
          },
        });
        emailToUserId.set(cleanEmail, created.id);
        totalUsersSeeded++;
      }
    }

    // 6. Pass 2: Establish reporting hierarchy (Reports To -> managerId)
    for (const userData of comp.users) {
      const cleanEmail = userData.email.toLowerCase().trim();
      const userId = emailToUserId.get(cleanEmail);
      if (!userId) continue;

      let managerId = null;
      if (userData.reportsToEmail) {
        const mgrClean = userData.reportsToEmail.toLowerCase().trim();
        managerId = emailToUserId.get(mgrClean) || null;
      }

      await prisma.tenantUser.update({
        where: { id: userId },
        data: { managerId },
      }).catch((err) => {
        console.warn(`    ⚠️ Could not set managerId for ${cleanEmail}: ${err.message}`);
      });
    }

    console.log(`  ✅ Successfully configured all ${comp.users.length} users and hierarchy for "${comp.companyName}".`);
  }

  console.log('======================================================');
  console.log(`🎉 Seeding complete! Tenants: 3, Total Users processed: 96.`);
  console.log('======================================================\n');
}

// Auto-execute ONLY when run directly: `node src/lib/seedCompanies.js`
const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).replace(/\.js$/, '') ===
    fileURLToPath(import.meta.url).replace(/\.js$/, '');

if (isDirectRun) {
  seedThreeCompanies()
    .catch((e) => {
      console.error('❌ Error seeding companies:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
