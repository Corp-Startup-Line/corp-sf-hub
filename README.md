# Corgi Pipeline OS — Dashboard (UI Shell)

A sales pipeline dashboard built with Next.js. Right now it shows **sample
(fake) data** so you can see and share the look and feel before real APIs
(HubSpot, Django CRM) are wired in.

---

## 1. How to run it on your Mac

Open the **Terminal** app, then paste these two lines (press Enter after each):

```bash
cd "/Users/carwyn/Dashboards/fugazi-dashboard"
npm run dev
```

You'll see a line like `Local: http://localhost:3000`. Hold **Cmd** and click
that link (or paste it into your browser). That's your dashboard.

**To stop the server:** click the Terminal window and press **Ctrl + C**.

> The web address `localhost` just means "this computer." Nobody else can see
> it — it's private to your Mac until you deploy it (see section 4).

---

## 2. Where the data lives (the ONE file to edit)

Everything on screen is calculated from one file:

```
app/lib/data.ts
```

Scroll to the list called `PROSPECTS`. Each line is one deal. Change a company
name, a stage, or a number, save the file, and the browser updates on its own.
The valid stages are listed at the top of that file (`Prospect`,
`Meeting Booked`, `Qualified`, `Quoted`, `Closed Won`, `Ghosting`).

Team targets (quota) are in the `QUOTA` section of the same file.

---

## 3. Where real APIs plug in later

In `app/lib/data.ts` there's a function called `getProspects()`. Today it
returns the fake list. When you're ready to go live, that's the single spot you
change to fetch from a real API — the rest of the dashboard keeps working. The
recommended approach is a Next.js "route handler" (a `app/api/...` file) so your
secret API keys stay on the server and never reach the browser.

---

## 4. How to put it online (Vercel)

1. Make a free account at vercel.com.
2. Push this folder to a GitHub repo (or use the Vercel CLI).
3. In Vercel, click **Add New → Project**, pick the repo, and press **Deploy**.
   Vercel auto-detects Next.js — you don't configure anything.

You'll get a public link like `your-project.vercel.app`.

---

## 5. Troubleshooting — the problems you're most likely to hit

**"npm error EACCES ... /Users/carwyn/.npm"**
Your npm cache has old files owned by "root." One-time fix (it'll ask for your
Mac password — nothing is deleted, it just fixes ownership):
```bash
sudo chown -R $(id -u):$(id -g) ~/.npm
```

**"Port 3000 is in use"**
Something else is already using that address. Not a problem — Next.js just uses
3001 (or the next free number) and prints the correct link. Use whichever link
it shows. To free 3000 yourself: `lsof -ti:3000 | xargs kill`.

**The page won't load / "This site can't be reached"**
The dev server isn't running. Go back to Terminal and run `npm run dev` again.
Make sure you're using the exact `http://localhost:PORT` it printed.

**A red error box fills the screen after I edit a file**
Usually a typo — a missing comma, quote, or bracket in `data.ts`. The error box
names the file and line. Fix that spot, save, and it clears itself.

**"Hydration mismatch" warning**
Already handled in this project. If you add features that show the current time
or random values, wrap them so they only run in the browser (see `Header.tsx`
for the pattern using `useEffect`).

**I changed data but nothing updated**
Make sure you **saved** the file (Cmd+S) and that the `npm run dev` server is
still running in Terminal.

**Command not found: npm / node**
Node.js isn't installed (or a new Terminal forgot it). Install from nodejs.org,
then fully quit and reopen Terminal.

---

## Note on the numbers

Because the sample filter defaults to **All Time** but quota targets are
**monthly**, some progress bars read over 100% (e.g. "Team Progress 202%"). Pick
a single month in the filter bar to see realistic monthly progress. When real
data and proper timeframes are connected, this lines up correctly.
