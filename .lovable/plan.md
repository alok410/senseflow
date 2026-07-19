## Plan: Make dashboard values stop showing 0

### Confirmed issue
- The local `meter_readings` table currently has **0 rows**, so any dashboard card or chart that reads only local stored readings will show `0` / “No consumption in range.”
- The app does have **26 configured devices**, including the main meter `USFL_FL7053`, so the dashboard should use the external Senseflow API for live totals and only fall back to local readings when live data is unavailable.

### What I’ll change
1. **Restore live dashboard data path**
   - Update the Admin dashboard to call the existing backend dashboard stats function again for:
     - Main Meter Today
     - Main Meter This Month
     - Main Meter Total Usage
     - Flow rate
     - Consumption trend
     - Top consumers

2. **Keep filters responsive**
   - Keep locations, consumer list, secretary count, and dropdown filters loaded directly from the database so filters don’t get stuck waiting for the external API.

3. **Make live API failure safe**
   - Ensure the dashboard does not become blank if one Senseflow device is slow/failing.
   - Show partial live values where available, and a clear fallback state only for missing sections.

4. **Verify data mapping**
   - Ensure the backend uses `device_id` values like `USFL_FL7053` / `USFL_WMxxxx` as the Senseflow API parameter.
   - Ensure the main meter is excluded from consumer counts/top-consumer lists but included in the Main Meter Overview.

5. **Update bug log**
   - Add a new top entry in `docs/BUGLOG.md` with the next patch version, per your project rule.

### Files expected to change
- `src/routes/_authenticated/admin/index.tsx`
- `src/lib/meter.functions.ts` if the live stats function needs timeout/fallback adjustments
- `docs/BUGLOG.md`