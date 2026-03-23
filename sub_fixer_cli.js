#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const path = require('path');

// CLI 參數解析 
const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
    console.log(`
=========================================================
🚀 CLI-Anything: 字幕全能工具終端機版 (sub_fixer_cli.js)
=========================================================
透過自然語言與命令列，自動分析並執行 \`sub_fixer.html\` 核心邏輯。

使用方式:
  node sub_fixer_cli.js apply --sub <字幕檔> --rules <修正詞檔> --out <輸出檔> [--json]
  node sub_fixer_cli.js scan --sub <字幕檔> --rules <修正詞檔> --out <報表檔.json>
  node sub_fixer_cli.js add-rule --rules <修正詞檔> --rule "-<原文[修正]|排除>"
  node sub_fixer_cli.js shift --sub <字幕檔> --time <位移時間, 例如 +00:00:02,500> --out <輸出檔>
  node sub_fixer_cli.js repl
    `);
}

function parseArgs(argsList) {
    const parsed = {};
    for (let i = 0; i < argsList.length; i++) {
        if (argsList[i].startsWith('--')) {
            const key = argsList[i].substring(2);
            if (i + 1 < argsList.length && !argsList[i + 1].startsWith('--')) {
                parsed[key] = argsList[i + 1];
                i++;
            } else {
                parsed[key] = true;
            }
        }
    }
    return parsed;
}

const params = parseArgs(args.slice(1));

// 解析修正詞庫格式: -<原文[修正]>
function parseCorrectionText(text) {
    const rules = [];
    const ruleRegex = /-<(.*?)\[(.*?)\](?:\|(.*))?>/g;
    let match;
    while ((match = ruleRegex.exec(text)) !== null) {
        const original = match[1].trim();
        const corrected = match[2].trim();
        const excludes = match[3] ? match[3].split(',').map(s => s.trim()) : [];
        if (original) {
            rules.push({ original, corrected, excludes });
        }
    }
    return rules;
}

// 替換實作
function applyCorrections(subText, rules) {
    let outputText = subText;
    let count = 0;

    // Generate a unique token prefix to safeguard excludes
    const tokenPrefix = "@@SUBFIX_EXCLUDE_";

    for (const rule of rules) {
        const { original, corrected, excludes } = rule;

        // 1. Mask excludes
        const maskedMap = new Map();
        let tokenIndex = 0;
        if (excludes && excludes.length > 0) {
            for (const ex of excludes) {
                if (!ex) continue;
                const exEscaped = ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const exRegex = new RegExp(exEscaped, 'g');
                outputText = outputText.replace(exRegex, (match) => {
                    const token = `${tokenPrefix}${tokenIndex++}@@`;
                    maskedMap.set(token, match);
                    return token;
                });
            }
        }

        // 2. Perform replacement
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        const matches = outputText.match(regex);
        if (matches) {
            count += matches.length;
            outputText = outputText.replace(regex, corrected);
        }

        // 3. Unmask excludes
        if (maskedMap.size > 0) {
            for (const [token, match] of maskedMap.entries()) {
                outputText = outputText.replace(new RegExp(token, 'g'), match);
            }
        }
    }
    return { outputText, count };
}

// 時間位移實作
function timeToMs(timeStr) {
    if (!timeStr) return 0;
    let isNegative = timeStr.startsWith('-');
    if (isNegative || timeStr.startsWith('+')) timeStr = timeStr.substring(1);
    const parts = timeStr.split(/[:,.]/);
    if (parts.length < 3) return 0;
    let hh = parseInt(parts[0]) || 0;
    let mm = parseInt(parts[1]) || 0;
    let ss = parseInt(parts[2]) || 0;
    let ms = parseInt(parts[3] ? parts[3].padEnd(3, '0').substring(0, 3) : 0) || 0;
    const totalMs = (hh * 3600 + mm * 60 + ss) * 1000 + ms;
    return isNegative ? -totalMs : totalMs;
}

function msToTime(ms) {
    let sign = ms < 0 ? '-' : '';
    ms = Math.abs(Math.round(ms));
    const hh = Math.floor(ms / 3600000); ms %= 3600000;
    const mm = Math.floor(ms / 60000); ms %= 60000;
    const ss = Math.floor(ms / 1000); ms %= 1000;
    const pad = (n) => String(n).padStart(2, '0');
    return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)},${String(ms).padStart(3, '0')}`;
}

function shiftSubtitleTime(subText, shiftMs) {
    return subText.replace(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g, (match, p1, p2) => {
        let startMs = timeToMs(p1) + shiftMs;
        let endMs = timeToMs(p2) + shiftMs;
        return `${msToTime(Math.max(0, startMs))} --> ${msToTime(Math.max(0, endMs))}`;
    });
}

function inferPaths() {
    if (!params.sub) return;
    if (!params.rules) {
        params.rules = params.sub.includes('_input.srt') 
            ? params.sub.replace('_input.srt', '_rules.txt') 
            : params.sub.replace('.srt', '_rules.txt');
    }
    if (!params.out) {
        params.out = params.sub.includes('_input.srt') 
            ? params.sub.replace('_input.srt', '_output.srt') 
            : params.sub.replace('.srt', '_output.srt');
    }
}

function handleScan() {
    inferPaths();
    if (params.sub && params.out && !params.out.endsWith('.json') && params.out.endsWith('.srt')) {
        params.out = 'report.json';
    }
    if (!params.sub || !params.rules || !params.out) {
        console.error("錯誤: 缺少參數。請提供 --sub。");
        process.exit(1);
    }
    try {
        const subData = fs.readFileSync(params.sub, 'utf-8');
        let rulesData = '';
        if (fs.existsSync(params.rules)) {
            rulesData = fs.readFileSync(params.rules, 'utf-8');
        } else {
            console.log("⚠️ 規則檔不存在，將使用空規則庫進行掃描。");
        }
        const rules = parseCorrectionText(rulesData);

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

                results.push({
                    blockId: item.id,
                    time: item.time,
                    replacements: matchedRules,
                    contextDisplay: `${prev2} | ${prev} | [${item.text.replace(/\n/g, ' ')}] | ${next} | ${next2}`
                });
            }
        }

        fs.writeFileSync(params.out, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`✅ 掃描完成！發現 ${matchCount} 處潛在的修正，結果已儲存至: ${params.out}`);
    } catch (e) {
        console.error("執行失敗:", e.message);
        process.exit(1);
    }
}

function handleAddRule() {
    if (!params.rules || !params.rule) {
        console.error("錯誤: 缺少參數。請提供 --rules 與 --rule (格式 -<原文[修正]|排除>)。");
        process.exit(1);
    }
    try {
        let rulesData = "";
        if (fs.existsSync(params.rules)) {
            rulesData = fs.readFileSync(params.rules, 'utf-8');
        }

        // check if rule format is slightly valid
        const match = /-<(.*?)\[/.exec(params.rule);
        if (!match) {
            console.error("錯誤: 規則格式不符合 -<原文[修正]|排除>。");
            process.exit(1);
        }
        const original = match[1].trim();

        const existingRules = parseCorrectionText(rulesData);
        const exists = existingRules.find(r => r.original === original);

        if (exists) {
            console.log(`⚠️ 規則已存在: 原文 [${original}]，取代其舊規則或請手動編輯檔案。若要覆蓋，目前需人工編輯。`);
        } else {
            fs.appendFileSync(params.rules, `\n${params.rule}`, 'utf-8');
            console.log(`✅ 已成功添加新規則: ${params.rule}`);
        }
    } catch (e) {
        console.error("執行失敗:", e.message);
        process.exit(1);
    }
}

function handleApply() {
    inferPaths();
    if (!params.sub || !params.rules || !params.out) {
        if (params.json) {
            console.log(JSON.stringify({ status: "error", message: "Missing arguments. Need --sub" }));
        } else {
            console.error("錯誤: 缺少參數。請至少提供 --sub。");
        }
        process.exit(1);
    }
    try {
        const subData = fs.readFileSync(params.sub, 'utf-8');
        let rulesData = '';
        if (fs.existsSync(params.rules)) {
            rulesData = fs.readFileSync(params.rules, 'utf-8');
        } else {
            console.log(`⚠️ 規則檔 ${params.rules} 不存在，已自動幫您建立空規則檔。`);
            fs.writeFileSync(params.rules, '', 'utf-8');
        }
        const rules = parseCorrectionText(rulesData);

        const { outputText, count } = applyCorrections(subData, rules);
        fs.writeFileSync(params.out, outputText, 'utf-8');

        if (params.json) {
            console.log(JSON.stringify({ status: "success", corrections_made: count, output_file: params.out }));
        } else {
            console.log(`✅ 轉換成功！總共修正了 ${count} 處。輸出檔案: ${params.out}`);
        }
    } catch (e) {
        if (params.json) {
            console.log(JSON.stringify({ status: "error", message: e.message }));
        } else {
            console.error("執行失敗:", e.message);
        }
        process.exit(1);
    }
}

function handleShift() {
    if (!params.sub || !params.time || !params.out) {
        console.error("錯誤: 缺少參數。請提供 --sub, --time, 與 --out。");
        process.exit(1);
    }
    try {
        const subData = fs.readFileSync(params.sub, 'utf-8');
        const shiftMs = timeToMs(params.time);
        const newSub = shiftSubtitleTime(subData, shiftMs);
        fs.writeFileSync(params.out, newSub, 'utf-8');
        console.log(`✅ 時間偏移調整成功 (位移 ${params.time})！輸出檔案: ${params.out}`);
    } catch (e) {
        console.error("執行失敗:", e.message);
        process.exit(1);
    }
}

function handleRepl() {
    console.log("========================================");
    console.log("啟動 REPL 互動模式。支援 Undo/Redo 的 CLI 引擎...");
    console.log("可用指令:");
    console.log("  load <sub_file>   - 載入字幕");
    console.log("  apply <rule>      - 應用單一規則 (格式: -<原文[修正]>)");
    console.log("  save <out_file>   - 儲存字幕");
    console.log("  undo              - 還原上一步");
    console.log("  exit              - 退出");
    console.log("========================================");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'sub_fixer> '
    });

    let currentSub = "";
    let history = [];

    rl.prompt();

    rl.on('line', (line) => {
        const input = line.trim();
        if (input.startsWith('load ')) {
            const file = input.substring(5).trim();
            try {
                currentSub = fs.readFileSync(file, 'utf-8');
                history = [currentSub];
                console.log(`✅ 載入成功: ${file} (大小: ${currentSub.length} 字元)`);
            } catch (e) {
                console.log(`❌ 載入失敗: ${e.message}`);
            }
        } else if (input.startsWith('apply ')) {
            const ruleStr = input.substring(6).trim();
            const rules = parseCorrectionText(ruleStr);
            if (rules.length === 0) {
                console.log("⚠️ 規則格式錯誤，請使用 -<原文[修正]>");
            } else {
                const result = applyCorrections(currentSub, rules);
                history.push(currentSub);
                currentSub = result.outputText;
                console.log(`✅ 已應用規則，共修改了 ${result.count} 處。`);
            }
        } else if (input === 'undo') {
            if (history.length > 0) {
                currentSub = history.pop();
                console.log("⏪ 已還原上一步驟。");
            } else {
                console.log("⚠️ 沒有可還原的步驟。");
            }
        } else if (input.startsWith('save ')) {
            const file = input.substring(5).trim();
            try {
                fs.writeFileSync(file, currentSub, 'utf-8');
                console.log(`✅ 已儲存字幕至: ${file}`);
            } catch (e) {
                console.log(`❌ 儲存失敗: ${e.message}`);
            }
        } else if (input === 'exit' || input === 'quit') {
            console.log("👋 退出 REPL 模式。");
            process.exit(0);
        } else if (input) {
            console.log("❔ 未知的指令。可用指令: load, apply, save, undo, exit");
        }
        rl.prompt();
    }).on('close', () => {
        console.log("👋 退出 REPL 模式。");
        process.exit(0);
    });
}

switch (command) {
    case 'apply':
        handleApply();
        break;
    case 'scan':
        handleScan();
        break;
    case 'add-rule':
        handleAddRule();
        break;
    case 'shift':
        handleShift();
        break;
    case 'repl':
        handleRepl();
        break;
    default:
        showHelp();
        break;
}
