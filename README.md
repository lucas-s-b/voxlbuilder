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
- **Test tab**: damage simulator using the wiki's damage formula (scaling, level, damage bonuses, Rage,
  crits, armor penetration vs. target defenses). Toggle rune buffs (e.g. Rage Rune), DoTs (Burn/Bleed/Poison
  in dmg/s with potency perks), on-hit procs, then see per-hit damage, sustained DPS, average DPS over a
  rotation and a damage-per-second chart. The rotation toggles M1 combo, M2, weapon art, rune, special
  and custom attack separately (custom/special take your own cooldown), either **on cooldown** for a
  fight length or **by count** (e.g. 5 M1 combos, 2 M2s, 3 arts), which reports the time taken and
  total ÷ time. Only one action runs at a time: each locks you for its cast time, and move-stackable
  ones (e.g. Starstream, Focus) keep hitting over their active time while you attack. The wiki has no
  cast times, so arts default to estimates you can override per action; weapon arts speed up only from
  weapon/stat attack speed, Quickcast and Stone Weapon. Monk spirits fire when Spirit Commune energy is full
- **Rotation order**: ▲▼ set the priority. By count the order is strict (M1 combo on top = all combos
  first); on cooldown, actions above the M1 combo cut into it and actions below wait for it to finish.
  E.g. Starstream above the Rage Rune casts it before Rage, so it doesn't get the Rage bonus
- **Survival card** (`js/support.js`): pick a wiki enemy and attack (47 mobs scraped from their pages, with
  damage types, hit counts and guardbreaks) or enter your own, then one incoming attack against your defenses (type defenses,
  damage reduction, blocks, dodges, shield, stun) plus healing per second, minion multipliers, poise and
  utility perks, so every perk on the wiki has a modeled effect
- **Weapon art frame**: icons, only the arts your weapon can equip (Weapon Arts requirements, hybrid
  bonus excluded), damage per cast, cooldown, cast time and type split for the picked art
- Click anything in the Character tab to pin its description (hover still previews)

### Perks, statuses and potions in the Test tab
- ~180 damage-relevant perks are modeled from their wiki formulas (`js/effects.js`): damage boosts, type bonuses and
  conversions, crit chance/damage, armor penetration, attack speed, cooldowns, on-hit / finisher / cast procs, echo damage
  (Phantom Pain, chain lightning, …), DoT changes, per-second auras and RMB / weapon art replacements.
- Every perk toggle only appears when your build has that perk; situational ones (airborne, behind the target, …) start off.
- Status effects (Rage, Tailwind, Bounce, Inspired, Critical Boost, Shatter, Sticky variants, Frostbite, …) only appear when
  something in your build — or a picked potion — provides them. Potions: Rage, Poison, Throwable Damage, Throwable Poison
  (Potion Chugger scales them).
- Defensive damage perks (Thorns, Blastshield, Magic Guard, …) use "blocks / hits taken per 10s" inputs; perks that trigger on
  applying a status (Barbed Flurry, Cauterize, Hex Ray, Ice Burst) use per-attack application chances from your build.
- Lucky rerolls every chance-based proc (`1 − (1−p)(1−⅔p)^⌊L⌋(1−⅔p·frac)`) and applies its stat penalties.
- Every hit, proc, echo, DoT and aura shows its damage-type split (% and damage), plus damage by type for the whole fight.
- Perk Effectiveness and Cursed scale perk amounts globally (except the perks the wiki excludes and enchant perks), and
  stat-converting perks (Brawny, Strong Tides, Weight Distribution, Rocky Body, …) are applied to your stat totals.

### Test tab assumptions
- M1 combo and M2 base damage per weapon form come from an in-game table (`MOVES` in `js/model.js`); the weapon
  form follows stance perks (Dual Wielding, Duelist Stance, Kama Blades, Lance, Saw Stance/Heart), core perks
  (Artillery Mage, Stratos Winds, Storm Caster, Virulent Core), RMB replacements (Cosmic Ray, Mine) and the Blaster Ring.
- Base swing time defaults to 0.5s per swing (editable); all swings in a combo are timed the same.
- DoTs are assumed to stay applied for the whole fight; casts are instant.
- Perks whose damage effects aren't modeled are listed under "Not simulated".

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
guild rules are in `js/model.js`, the damage model in `js/damage.js`, and the Character/Test views in `js/views.js`.

Fan-made; not affiliated with Voxlblade.
