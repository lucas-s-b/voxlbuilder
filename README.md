# Voxlbuilder

A build planner for the Roblox game **Voxlblade**, styled after the in-game inventory.

- 5 equipment slots: Helmet, Ring, Chestplate, Rune, Leggings
- Every slot opens a list of all items for that slot, with search, stat sorting and favorites
- Forge levels 0–5 per piece (`stat × (1 + lvl/10)`, negatives `÷ (1 + lvl/10)`)
- Up to 3 enchants per piece (default + ascended), with the wiki's combination rules
  (Legendary/Mythical/Corrupt/Warped are single-only; Thirsty, Sweet and Corroded families don't mix)
- Infusions for Helmet, Chestplate, Leggings and Ring: grant the perk + 50% of the stats, levels 0–5, no enchants
- Totals panel (Boosts, Defenses, derived numbers like crit chance and damage reduction), perk list, build notes
- 3 loadouts saved in the browser, share links (`#b=…`) and a copy-as-text summary
- **Character tab**: race (passives applied), guild + rank (stats and perks), weapon from Handle + Blade or
  Gloves + Essence (Monk), with Shrine of Balance tier bonus, automatic Hybrid ×1.5 scaling, Monk rank bonus and weapon art
- **Character tab**: race, guild and weapon art collapse to your current pick (CHANGE to reopen); the part list opens
  when you click a part slot
- **Test tab**: four tests (DPS, Tank, Debuff, Healing) share one combat simulation. Your sequence plays out on a
  timeline: every perk, buff, debuff, proc, DoT, heal and cooldown is applied when it happens, every chance is rolled,
  and the results are the average of many simulated fights
- **Sequences**: each test has its own list of steps (M1 combo, M2, weapon art, rune, draconic rune, special, throwable
  potion, custom hit or a wait), run once (steps on cooldown wait for it) or repeated for a fight length (steps on
  cooldown are skipped that loop). M2s and chargeable arts have a charge slider
- **Buffs**: start the fight with buffs or debuffs from allies, drink potions, turn situational perks on, set the
  conditions your perks read (your HP, enemies in range, sunlight, ...) and untick any perk to compare
- **Results**: DPS shows each step's damage, a damage per second chart, damage by type, one use of any action with its
  formula, and the uptime and potency of every buff and debuff. Tank shows damage taken per second against the enemy's
  attacks, with dodges, blocks, parries, shield, stun and deaths. Debuff shows how often each debuff is applied and how
  long it stays up. Healing shows healing per second on you and on allies, by source
- **Rules tab**: every perk, status effect, weapon form, weapon art, rune, monk spirit, potion and constant the tests
  use is plain data in `data/rules/`, with formulas written as text (`"1 + 0.1 * amount"`). Edit any entry in the
  site: edits are saved in your browser and can be exported and imported as a JSON file. To change the defaults for
  everyone, edit the files in `data/rules/`
- **Weapon art frame**: icons, only the arts your weapon can equip (Weapon Arts requirements, hybrid
  bonus excluded), damage per cast, cooldown, cast time and type split for the picked art
- Click anything in the Character tab to pin its description (hover still previews)
- **Short share links**: `#c=` codes are the build compacted (Test settings only where they differ from the
  defaults), deflate-compressed and base64url'd — about a quarter of the old size. Old `#b=` links still load
- **Workshop tab**: publish builds with a title, description and tags; browse by TOP/NEW, search, tag, race, guild
  and weapon; like (♥), load into your loadout (undoable), copy a tiny `#w=<id>` link, and delete your own builds
- **Draconic guild rune infusion** (Draconic Blood page): with the Draconic guild you pick the draconic rune on
  its extra rune key (Dragon Claw at rank 1, Dragon Infusion from rank 2, Dragon Bubble at rank 3) and your Dragon
  Blooded color. It's its own action in the Test tab sequences: Claw/Bubble damage of your color (Physical for other
  races) with the color's attack stats, Dragon Infusion's buff windows adding your color's damage type to every
  attack, and color effects on Burn, debuffs, healing, stun and poise. As a rune infusion it uses rune cooldown
  effects and rune damage perks

### How the simulation works
- Damage follows the wiki's formula: base damage, scaling, level, damage bonuses, damage reduced, damage type, type
  multipliers, crit and armor, in that order.
- Statuses are applied by the attacks and perks that cause them, with their potency and duration changes, and only
  count while they last.
- Armor penetration, Shatter and other armor reductions, crit chance from Dexterity and perks, Lucky rerolls, proc
  coefficients, cooldown reduction, cooldown speed and flat reductions follow the wiki's Armor Penetration, Critical
  Hit, Lucky and Cooldowns pages.
- M1 and M2 base damage per weapon form, cast times and minion attack timings are in `data/rules/attacks.js`. The wiki
  gives no cast times, so those are estimates you can change in the Rules tab.
- Perks marked as not simulated are listed under OTHER PERKS.

## Running

It's a static site with no build step. Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8765
```

## Updating game data

All item, perk and enchant data comes from the [Voxlpedia wiki](https://voxlpedia.miraheze.org/wiki/Voxlblade_Wiki)
and is generated into `data/data.js`, with images in `assets/img/`.

```bash
python scripts/scrape_wiki.py --refresh
```

Install [Pillow](https://pypi.org/project/pillow/) to also trim and downscale the downloaded images (optional).
Enchant math lives in `js/enchants.js` and `js/calc.js`, mirroring the wiki's enchant table. Weapon, race and
guild rules are in `js/model.js`, the combat simulation in `js/engine/`, the rules it reads in `data/rules/`, the
Character view in `js/views.js` and the Test view in `js/view-test.js` (its text is in `js/test-text.js`).

Fan-made; not affiliated with Voxlblade.

## Workshop database (Supabase)
The workshop stores builds in a free Supabase project. `js/config.js` holds the project URL and its public
(publishable/anon) key, which is meant to be public. `supabase/schema.sql` sets the database up; run it once in
the Supabase SQL editor. Visitors can only read visible builds; publishing, liking and deleting go through
checked functions (size limits, 5 publishes per connection per hour, one like per connection, delete only with
the publisher's secret token). To moderate, tick `hidden` on a row in Table Editor → builds, or delete it.
