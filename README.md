# Computer Lab Fault Reporting System v4

## What's New in v4

### New Features
- **Priority Levels** — Students can now mark faults as High, Medium, or Low priority
- **Search & Filter** — Admin can search and filter faults by status, type, and keyword
- **Analytics Dashboard** — 7-day fault trend bar chart + top faulty labs progress bars
- **Technician Workload** — Admin sees task counts per technician when assigning
- **Technician Performance Cards** — Completion rate % with progress bars
- **Feedback Analytics** — Star rating distribution chart on feedback page
- **CSV Export** — Admin can download all fault reports as a spreadsheet
- **Toast Notifications** — Non-intrusive popup confirmations instead of alert() dialogs
- **Solution Search** — Students can search the self-help solutions library
- **Mobile Responsive** — Hamburger menu on small screens, sidebar slides in/out
- **Loading States** — Spinner on login button, loading indicators for data

### Improvements
- Priority-ordered fault listing (high → medium → low)
- Better stat cards with accent color bars
- Smoother animations and transitions
- Improved notification panel design
- Better form validation messages
- Cleaner table designs with hover states
- More informative empty states

## Setup
1. Run `database_setup.sql` in phpMyAdmin
   - If upgrading from v3, run the ALTER TABLE comment at the bottom
2. Update MySQL password in `server.js` (line ~12)
3. Run `node server.js`
4. Open http://localhost:3000

## Demo Accounts
- admin@lab.com / admin123
- student@lab.com / student123
- tech@lab.com / tech123
