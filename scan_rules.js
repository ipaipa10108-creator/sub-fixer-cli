const fs = require('fs');
const path = require('path');

const subFilePath = path.join(__dirname, '信託實務-從法規到操作的完整指南-蔡地政士估價師_input.srt');
const rulesFilePath = path.join(__dirname, '信託實務-從法規到操作的完整指南-蔡地政士估價師_rules.txt');

const subData = fs.readFileSync(subFilePath, 'utf-8');
const rulesData = fs.readFileSync(rulesFilePath, 'utf-8');

const rules = [];
const ruleRegex = /-<(.*?)\[(.*?)\](?:\|(.*?))?>/g;
let match;
while ((match = ruleRegex.exec(rulesData)) !== null) {
    const original = match[1].trim();
    const corrected = match[2].trim();
    const excludes = match[3] ? match[3].split(',').map(s => s.trim()) : [];
    if (original) {
        rules.push({ original, corrected, excludes });
    }
}

// Parse SRT into blocks
const blocks = subData.trim().split(/\r?\n\r?\n/);
const parsedSub = blocks.map(block => {
    const lines = block.split(/\r?\n/);
    return {
        id: lines[0],
        time: lines[1],
        text: lines.slice(2).join('\n')
    };
});

let matchCount = 0;
const results = [];

for (let i = 0; i < parsedSub.length; i++) {
    const item = parsedSub[i];
    let matchedRules = [];

    rules.forEach(rule => {
        if (item.text.includes(rule.original)) {
            // Check excludes in current, previous and next line just to be safe
            let contextForExclude = item.text;
            if (i > 0) contextForExclude += ' ' + parsedSub[i - 1].text;
            if (i < parsedSub.length - 1) contextForExclude += ' ' + parsedSub[i + 1].text;

            let excluded = false;
            for (let ex of rule.excludes) {
                if (contextForExclude.includes(ex)) {
                    excluded = true;
                    break;
                }
            }
            if (!excluded) {
                matchedRules.push(rule);
            }
        }
    });

    if (matchedRules.length > 0) {
        matchCount += matchedRules.length;
        const prev2 = i > 1 ? parsedSub[i - 2].text.replace(/\n/g, ' ') : '';
        const prev = i > 0 ? parsedSub[i - 1].text.replace(/\n/g, ' ') : '';
        const next = i < parsedSub.length - 1 ? parsedSub[i + 1].text.replace(/\n/g, ' ') : '';
        const next2 = i < parsedSub.length - 2 ? parsedSub[i + 2].text.replace(/\n/g, ' ') : '';

        let allReplacements = matchedRules.map(r => `${r.original} -> ${r.corrected}`).join(', ');

        results.push({
            blockId: item.id,
            index: i,
            replacements: matchedRules,
            contextDisplay: `${prev2} | ${prev} | [${item.text.replace(/\n/g, ' ')}] | ${next} | ${next2}`
        });
    }
}

console.log(`Found ${matchCount} potential replacements to review.`);
fs.writeFileSync(path.join(__dirname, 'review_matches.json'), JSON.stringify(results, null, 2), 'utf-8');
console.log('Results saved to review_matches.json');
