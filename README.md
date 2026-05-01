# Ashesi Campus 360° — Navigation & Issue Reporting

An interactive 360° virtual tour of the Ashesi University campus with built-in navigation and facility issue reporting.


## Before you start

You need one thing that is **not** included in the zip/repo:

**A Supabase account** — free at [supabase.com](https://supabase.com). Takes 2 minutes to create.

The panorama images (tiles) are served from a CDN and load automatically — no large files to download.



## Step 1 — Set up the database

1. Log in to Supabase and open your project.
2. Go to **SQL Editor** and paste in the entire contents of `database/SCHEMA.sql`.
3. Click **Run**. That's it — all tables and settings are created automatically.



## Step 2 — Create an image storage bucket

1. In Supabase, go to **Storage → New bucket**.
2. Name it exactly: `issue-images`
3. Turn **Public** on.
4. Click **Create**.



## Step 3 — Add your credentials

1. In the project folder, find the file `env.example.js` and make a copy of it named `env.js`.
2. Open `env.js` and fill in your Supabase details:

```js
window.ENV = {
  SUPABASE_URL:  'https://your-project-id.supabase.co',
  SUPABASE_ANON: 'your-anon-public-key'
};
```

You can find both values in Supabase under **Project Settings → API**.



## Step 4 — Run it

Open a terminal in the project folder and run:

```bash
npx serve .
```

Then open **http://localhost:3000** in your browser.

> If you don't have Node.js, you can use Python instead: `python3 -m http.server 8080` and open **http://localhost:8080**.



## What you can do

**Navigate the campus**
Type any building or location in the search bar. The system will guide you through the 360° tour step by step with a directional arrow.

**Report a facility issue**
Click the flag button, drag a box over the problem area in the panorama, fill in the form, and submit. Reports are saved to your database.

**View a submitted report**
Open this URL in your browser, replacing the ID with any report ID from your Supabase `issues` table:

```
http://localhost:3000/logistics.html?id=paste-issue-id-here
```

The panorama will jump to the exact spot where the issue was reported and highlight the area.

---

## Note on email

Only **@ashesi.edu.gh** and **@ug.ashesi.edu.gh** email addresses can submit reports. Using any other email will show an error — this is intentional.
