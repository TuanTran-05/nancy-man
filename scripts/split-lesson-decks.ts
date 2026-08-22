/**
 * One-off script to split globalSuccessLessonDecks.ts into per-unit files.
 *
 * Run with: npx tsx scripts/split-lesson-decks.ts
 *
 * Output structure:
 *   src/data/global-success/
 *     grade6/
 *       unit01.ts
 *       unit02.ts
 *       ...
 *     grade7/
 *       unit01.ts
 *       ...
 *     grade8/
 *       unit05.ts
 *       ...
 *     index.ts          ← re-exports everything
 */

import * as fs from 'fs';
import * as path from 'path';

// Import the existing data
// We'll read the file and use eval-free parsing via dynamic import
const SCRIPT_DIR = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE = path.join(ROOT, 'src', 'data', 'globalSuccessLessonDecks.ts');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'global-success');

interface DeckBoundary {
  grade: number;
  unitNumber: number;
  startLine: number; // 0-indexed, the `{` line of the deck object
  endLine: number; // 0-indexed, the closing `},` or `}` line
}

function findDeckBoundaries(lines: string[]): DeckBoundary[] {
  const decks: DeckBoundary[] = [];
  let i = 0;

  // Find the array start line: `export const globalSuccessLessonDecks: LessonDeck[] = [`
  while (i < lines.length && !lines[i].includes('globalSuccessLessonDecks')) i++;
  if (i >= lines.length) throw new Error('Could not find globalSuccessLessonDecks');
  i++; // skip the `[` line

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // End of the array
    if (trimmed === '];') break;

    // Start of a deck object
    if (trimmed === '{') {
      const startLine = i;
      let grade = 0;
      let unitNumber = 0;
      let depth = 1;
      i++;

      while (i < lines.length && depth > 0) {
        const line = lines[i].trim();
        if (depth === 1) {
          const gradeMatch = line.match(/^grade:\s*(\d+)/);
          if (gradeMatch) grade = parseInt(gradeMatch[1]);
          const unitMatch = line.match(/^unitNumber:\s*(\d+)/);
          if (unitMatch) unitNumber = parseInt(unitMatch[1]);
        }

        // Count braces/brackets — handle array of objects
        for (const ch of line) {
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
        }

        if (depth === 0) {
          decks.push({ grade, unitNumber, startLine, endLine: i });
        }
        i++;
      }
    } else {
      i++;
    }
  }

  return decks;
}

function extractDeckContent(lines: string[], deck: DeckBoundary): string {
  // Get the raw lines for this deck
  const deckLines = lines.slice(deck.startLine, deck.endLine + 1);

  // Remove the leading indent (typically 2 spaces for top-level array items)
  const firstLine = deckLines[0];
  const indent = firstLine.match(/^(\s*)/)?.[1]?.length ?? 0;

  const dedented = deckLines.map((line) => {
    if (line.length <= indent) return line.trimEnd();
    return line.slice(indent);
  });

  // Remove trailing comma from the closing brace if present
  const lastIdx = dedented.length - 1;
  if (dedented[lastIdx].trim() === '},') {
    dedented[lastIdx] = dedented[lastIdx].replace(/},\s*$/, '}');
  }

  return dedented.join('\n');
}

function main() {
  console.log('Reading source file...');
  const content = fs.readFileSync(SOURCE, 'utf-8');
  const lines = content.split('\n');
  console.log(`Total lines: ${lines.length}`);

  console.log('Finding deck boundaries...');
  const decks = findDeckBoundaries(lines);
  console.log(`Found ${decks.length} decks:`);
  for (const d of decks) {
    console.log(
      `  Grade ${d.grade} Unit ${d.unitNumber}: lines ${d.startLine + 1}-${d.endLine + 1}`
    );
  }

  // Group by grade
  const byGrade = new Map<number, DeckBoundary[]>();
  for (const d of decks) {
    const list = byGrade.get(d.grade) || [];
    list.push(d);
    byGrade.set(d.grade, list);
  }

  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Track all generated files for the index
  const gradeFiles = new Map<number, string[]>();

  for (const [grade, gradeDecks] of byGrade) {
    const gradeDir = path.join(OUT_DIR, `grade${grade}`);
    fs.mkdirSync(gradeDir, { recursive: true });
    gradeFiles.set(grade, []);

    // Group by unit (multiple decks per unit possible)
    const byUnit = new Map<number, DeckBoundary[]>();
    for (const d of gradeDecks) {
      const list = byUnit.get(d.unitNumber) || [];
      list.push(d);
      byUnit.set(d.unitNumber, list);
    }

    for (const [unitNum, unitDecks] of byUnit) {
      const paddedUnit = String(unitNum).padStart(2, '0');
      const fileName = `unit${paddedUnit}.ts`;
      const filePath = path.join(gradeDir, fileName);

      const deckContents = unitDecks.map((d) => extractDeckContent(lines, d));

      let fileContent = `import { LessonDeck } from '../../../types';\n\n`;

      if (deckContents.length === 1) {
        fileContent += `const deck: LessonDeck = ${deckContents[0]};\n\n`;
        fileContent += `export default deck;\n`;
      } else {
        fileContent += `const decks: LessonDeck[] = [\n`;
        fileContent += deckContents.map((c) => `  ${c.split('\n').join('\n  ')},`).join('\n');
        fileContent += `\n];\n\n`;
        fileContent += `export default decks;\n`;
      }

      fs.writeFileSync(filePath, fileContent, 'utf-8');
      gradeFiles.get(grade)!.push(fileName);
      console.log(`  Created: ${path.relative(ROOT, filePath)} (${unitDecks.length} deck(s))`);
    }
  }

  // Create grade-level index files
  for (const [grade, files] of gradeFiles) {
    const gradeDir = path.join(OUT_DIR, `grade${grade}`);
    const sorted = [...files].sort();

    let indexContent = `import { LessonDeck } from '../../../types';\n\n`;

    const importLines: string[] = [];
    const spreadParts: string[] = [];

    for (const f of sorted) {
      const baseName = f.replace('.ts', '');
      importLines.push(`import ${baseName}Import from './${baseName}';`);
      spreadParts.push(`${baseName}Import`);
    }

    indexContent += importLines.join('\n') + '\n\n';
    indexContent += `// Normalize: each unit file exports a single LessonDeck or LessonDeck[]\n`;
    indexContent += `function flatten(value: LessonDeck | LessonDeck[]): LessonDeck[] {\n`;
    indexContent += `  return Array.isArray(value) ? value : [value];\n`;
    indexContent += `}\n\n`;
    indexContent += `const grade${grade}Decks: LessonDeck[] = [\n`;
    indexContent += spreadParts.map((p) => `  ...flatten(${p}),`).join('\n');
    indexContent += `\n];\n\n`;
    indexContent += `export default grade${grade}Decks;\n`;

    fs.writeFileSync(path.join(gradeDir, 'index.ts'), indexContent, 'utf-8');
    console.log(`  Created: src/data/global-success/grade${grade}/index.ts`);
  }

  // Create top-level index
  const grades = [...gradeFiles.keys()].sort();
  let topIndex = `import { LessonDeck } from '../../types';\n\n`;

  for (const g of grades) {
    topIndex += `import grade${g}Decks from './grade${g}';\n`;
  }

  topIndex += `\n`;
  topIndex += `export type GlobalSuccessGrade = 6 | 7 | 8 | 9;\n\n`;
  topIndex += `export interface GlobalSuccessUnit {\n`;
  topIndex += `  unitNumber: number;\n`;
  topIndex += `  title: string;\n`;
  topIndex += `}\n\n`;
  topIndex += `export const GLOBAL_SUCCESS_GRADES: GlobalSuccessGrade[] = [6, 7, 8, 9];\n\n`;
  topIndex += `export const GLOBAL_SUCCESS_UNITS: GlobalSuccessUnit[] = Array.from({ length: 12 }, (_, index) => ({\n`;
  topIndex += `  unitNumber: index + 1,\n`;
  topIndex += `  title: \`Unit \${index + 1}\`,\n`;
  topIndex += `}));\n\n`;
  topIndex += `export const getGlobalSuccessProgramName = (grade: GlobalSuccessGrade) =>\n`;
  topIndex += `  \`Grade \${grade} Global Success\`;\n\n`;
  topIndex += `export const isGlobalSuccessGrade = (value: number): value is GlobalSuccessGrade =>\n`;
  topIndex += `  GLOBAL_SUCCESS_GRADES.includes(value as GlobalSuccessGrade);\n\n`;
  topIndex += `export const getGlobalSuccessUnitTitle = (unitNumber: number) =>\n`;
  topIndex += `  GLOBAL_SUCCESS_UNITS.find((unit) => unit.unitNumber === unitNumber)?.title ||\n`;
  topIndex += `  \`Unit \${unitNumber}\`;\n\n`;
  topIndex += `export const globalSuccessLessonDecks: LessonDeck[] = [\n`;
  for (const g of grades) {
    topIndex += `  ...grade${g}Decks,\n`;
  }
  topIndex += `];\n\n`;
  topIndex += `export const getLessonDecksForUnit = (grade: GlobalSuccessGrade, unitNumber: number) =>\n`;
  topIndex += `  globalSuccessLessonDecks.filter((deck) => deck.grade === grade && deck.unitNumber === unitNumber);\n\n`;
  topIndex += `export const getLessonDeckById = (deckId: string) =>\n`;
  topIndex += `  globalSuccessLessonDecks.find((deck) => deck.id === deckId);\n`;

  fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), topIndex, 'utf-8');
  console.log(`  Created: src/data/global-success/index.ts`);

  console.log('\n✅ Done! Now update imports in consuming files:');
  console.log("   Change: from '../../data/globalSuccessLessonDecks'");
  console.log("   To:     from '../../data/global-success'");
}

main();
