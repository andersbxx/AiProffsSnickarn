# Användarguide — AiProffsSnickarn

> **C-kompilator för iPad med tangentbord.** Skriv C-kod, kör den direkt, få AI-hjälp — allt i webbläsaren.

---

## Kom igång

1. Öppna appen i Safari på din iPad (eller Chromebook Chrome).
2. Tryck på **Ny** → ge projektet ett namn → **Skapa**.
3. En `main.c` skapas med exempelkod (fibonacci). Tryck **▶ Kör** (eller ⌘⏎) för att kompilera och köra.
4. Utdata visas i den mörka panelen nedanför editorn.

> **Tips:** Appen fungerar offline efter första besöket (PWA). Lägg till på hemskärmen för snabb åtkomst.

---

## Redigera kod

- **Editor:** CodeMirror 6 med C-syntaxfärger.
- **Tab** indenterar (Shift+Tab = unindent).
- **⌘S** (eller **Spara**-knappen) sparar filen och gör auto-commit i Git.
- **Nya filer:** Tryck **Ny fil** → ange namn (t.ex. `util.c`) → OK.
- **Byt fil:** Klicka i filträdet till vänster.
- **Radera fil:** Klicka på ⨉ bredvid filnamnet.

---

## Git — versionshistorik

Varje projekt har sitt eget Git-repo (`.git/` i OPFS).

| Händelse | Commit-meddelande |
|----------|-------------------|
| Spara (⌘S) | `Spara <filnamn>` |
| Ny fil | `Ny fil <filnamn>` |
| Radera fil | `Radera <filnamn>` |
| Lyckad körning (rc 0) | `Lyckad körning av <filnamn>` *(endast om filen ändrats)* |

Historiken sparas lokalt i OPFS och överlever ominstallation/återställning.

---

## AI-assistent (panelen)

Öppna med **AI-knappen** (hjärna-ikonen) i verktygsfältet.

### Inställningar (första gången)

1. Klicka på **modell-chippet** (övre delen av panelen) → **Inställningar**.
2. Klistra in din **Gemini API-nyckel** (få på [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).
2. Välj modell (standard `gemini-2.5-flash` fungerar bra).
3. **Spara & börja bygga**.

> Nyckeln sparas **enbart i din webbläsare** (localStorage) och skickas direkt till Google.

### Två lägen

| Läge | Beskrivning |
|------|-------------|
| **Bygga** (standard) | AI genererar **C-kod**, applicerar den i editorn, sparar och committar automatiskt. |
| **Planera** | AI svarar med **text** (ingen kod). Använd för att diskutera algoritmer, arkitektur, felsökning. Klicka på **Bygg det här**-chippen för att växla till Bygga. |

### Tips för bättre resultat

- **Var specifik:** "Skriv en funktion som läser en CSV-fil rad för rad och returnerar en dynamisk array av structs."
- **Ge kontext:** AI ser automatiskt den aktuella filens innehåll.
- **Iterera:** "Gör den trådsäker", "Lägg till felhantering för tom fil", "Optimera för minne".
- **Planera först:** Använd **Planera** för att diskutera design innan du bygger.

### Förslagschips

I tomma panelen finns färdiga prompts (Quicksort, fil-läsning, malloc/free, länkad lista). Klicka för att testa snabbt.

---

## Tangentbordsgenvägar

| Genväg | Aktion |
|--------|--------|
| ⌘S | Spara aktiv fil (auto-commit) |
| ⌘⏎ | Kompilera & kör |
| Tab / Shift+Tab | Indent / unindent |
| Escape | Stäng AI-panel / inställningar |

---

## Felsökning

| Problem | Lösning |
|---------|---------|
| "Kunde inte köra" / kompilatorfel | Kolla utdata-panelen (radnummer + felmeddelande). Vanliga orsaker: saknad `;`, felaktiga typer, glömt `#include`. |
| AI svarar "överbefolkat" / 503 | Appen provar automatiskt fallback-modeller (gemini-3.5-flash-lite, etc.). Vänta några sekunder. |
| Ingen modell i listan | Kontrollera API-nyckel och internetanslutning. Klicka ↻ för att uppdatera. |
| Filen sparas men ändringar försvinner | Kontrollera att du tryckte **Spara** (⌘S) innan du byter fil. |
| Git-historik tom | Första commit sker vid första **Spara** eller **Ny fil**. |

---

## Arkiv & säkerhet

- **Allt lagras lokalt** i din webbläsare (OPFS + localStorage). Inget skickas till våra servrar.
- **API-nyckel** skickas **enbart till Google** (generativelanguage.googleapis.com).
- **Inga cookies, ingen tracking, inga analytics.**
- Rensa data: Safari → Inställningar → Avancerat → Webbläsardata → Ta bort.

---

## Avancerat

### Importera/exportera AI-sessioner (markdown)

I inställningarna / chatt-listan:
- **Exportera** → ladda ner `.md` med prompts + AI-svar + demo-HTML.
- **Importera .md** → välj en tidigare export för att återställa sessionen.

### Git-detaljer

- Repo ligger i `OPFS/projects/<uuid>/.git/`
- Branch: `main`
- Författare: `AiProffsSnickarn <snickarn@local>`
- Tomma commits skapas inte (endast vid riktiga ändringar).

---

## Kända begränsningar

- Endast **C (ISOC99)** — ingen C++, inga POSIX-systemanrop.
- **Ingen `localStorage` i AI-genererad kod** (kör i sandboxad iframe).
- Kompilatorn (tcc-wasm + wabt) laddas **lazily** första gången (kan ta 5–15 s).
- PWA på iOS: data kan rensas efter ~7 dagar inaktivitet (ITP).

---

## Support & bidrag

- **Issues:** [GitHub Issues](https://github.com/andersbxx/AiProffsSnickarn/issues)
- **Systerprojekt:** [AiSnickarn](https://github.com/andersbxx/AiPlayground) (HTML/JS-demo-byggare)
- **Licens:** MIT