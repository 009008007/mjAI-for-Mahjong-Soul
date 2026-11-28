// HUD translations. Preferences are separate from strategy and layout.
(() => {
  'use strict';
  const entries = [
    ['mjai · read only','mjai · 唯讀','mjai · 只读'],
    ['最佳牌顯示','最佳牌顯示','最佳牌显示','Show recommended tile'],
    ['危險牌顯示','危險牌顯示','危险牌显示','Show dangerous tiles'],
    ['主題','主題','主题','Theme'],
    ['黑綠','黑綠','黑绿','Black and green'],
    ['白色','白色','白色','White'],
    ['淺粉 × 淺藍','淺粉 × 淺藍','浅粉 × 浅蓝','Pink and light blue'],
    ['AI style / 風格','AI 風格','AI 风格','AI style'],
    ['Default · 預設','Default · 預設','Default · 默认','Default'],
    ['CallManiac · 副露速攻','CallManiac · 副露速攻','CallManiac · 副露速攻','CallManiac · fast calls'],
    ['SuperTurtle · 防守','SuperTurtle · 防守','SuperTurtle · 防守','SuperTurtle · defense'],
    ['Intensity / 強度','強度','强度','Intensity'],
    ['縮小 HUD','縮小 HUD','缩小 HUD','Shrink HUD'],
    ['放大 HUD','放大 HUD','放大 HUD','Enlarge HUD'],
    ['收合或展開 HUD','收合或展開 HUD','收起或展开 HUD','Collapse or expand HUD'],
    ['重設 HUD 位置和大小','重設 HUD 位置和大小','重设 HUD 位置和大小','Reset HUD position and size'],
    ['重設位置與大小','重設位置與大小','重设位置与大小','Reset position and size'],
    ['拖曳移動 HUD，或按方向鍵移動','拖曳移動 HUD，或按方向鍵移動','拖动 HUD，或按方向键移动','Drag the HUD or use arrow keys'],
    ['Adjust highlight','調整標記位置','调整标记位置','Adjust highlight'],
    ['Done adjusting','完成調整','完成调整','Done adjusting'],
    ['Yellow preview: align it with the chosen tile or action button.','將黃色預覽框對齊牌或操作按鈕。','将黄色预览框对齐牌或操作按钮。','Yellow preview: align it with the chosen tile or action button.'],
    ['Preview first tile','預覽第一張牌','预览第一张牌','Preview first tile'],
    ['Preview rightmost action','預覽最右操作按鈕','预览最右操作按钮','Preview rightmost action'],
    ['First tile: left/right','第一張牌：左右','第一张牌：左右','First tile: left/right'],
    ['Tiles: up/down','牌：上下','牌：上下','Tiles: up/down'],
    ['Tile spacing','牌間距','牌间距','Tile spacing'],
    ['Tile highlight width','牌標記寬度','牌标记宽度','Tile highlight width'],
    ['Tile highlight height','牌標記高度','牌标记高度','Tile highlight height'],
    ['Drawn tile gap','摸牌間距','摸牌间距','Drawn tile gap'],
    ['Rightmost action: left/right','最右操作：左右','最右操作：左右','Rightmost action: left/right'],
    ['Actions: up/down','操作：上下','操作：上下','Actions: up/down'],
    ['Action spacing','操作間距','操作间距','Action spacing'],
    ['Action row spacing','操作列間距','操作行间距','Action row spacing'],
    ['Action highlight width','操作標記寬度','操作标记宽度','Action highlight width'],
    ['Action highlight height','操作標記高度','操作标记高度','Action highlight height'],
    ['Reset positions','重設標記位置','重设标记位置','Reset positions'],
    ['Waiting for game traffic','等待遊戲資料','等待游戏数据','Waiting for game traffic'],
    ['Suggestion','建議','建议','Suggestion'],
    ['Analyzing','分析中','分析中','Analyzing'],
    ['Rebuilding game state','正在重建牌局','正在重建牌局','Rebuilding game state'],
    ['Recovering game state','正在恢復牌局','正在恢复牌局','Recovering game state'],
    ['Bridge disconnected; retrying','橋接程式已斷線，正在重試','桥接程序已断线，正在重试','Bridge disconnected; retrying'],
    ['Bridge connected; waiting for game','橋接已連線，等待牌局','桥接已连接，等待牌局','Bridge connected; waiting for game'],
    ['Extension disconnected; retrying','擴充功能已斷線，正在重試','扩展程序已断线，正在重试','Extension disconnected; retrying'],
    ['Extension updated or unavailable; reload this game tab','擴充功能已更新或無法使用，請重新整理遊戲頁面','扩展程序已更新或不可用，请刷新游戏页面','Extension updated or unavailable; reload this game tab'],
    ['Game state incomplete; reload the game','牌局資料不完整，請重新整理','牌局数据不完整，请刷新','Game state incomplete; reload the game'],
    ['Seat not detected; reload the game','未偵測到座位，請重新整理','未检测到座位，请刷新','Seat not detected; reload the game'],
    ['Seat changed; reload the game','座位已改變，請重新整理','座位已改变，请刷新','Seat changed; reload the game'],
    ['Style updated; applies at next decision','風格已更新，下次決策生效','风格已更新，下次决策生效','Style updated; applies at next decision'],
    ['Discard','切牌','切牌','Discard'],['Riichi','立直','立直','Riichi'],
    ['Win','和牌','和牌','Win'],['Draw','流局','流局','Draw'],
    ['Open kan','大明槓','大明杠','Open kan'],['Closed kan','暗槓','暗杠','Closed kan'],
    ['Added kan','加槓','加杠','Added kan'],['Chi','吃','吃','Chi'],
    [' Characters','萬','万',' Characters'],[' Dots','筒','筒',' Dots'],[' Bamboo','條','条',' Bamboo'],
    [' (red five)','（赤五）','（赤五）',' (red five)'],
    ['Pon','碰','碰','Pon'],['Pass','跳過','跳过','Pass'],
    ['Use:','使用：','使用：','Use:'],['Shanten:','向聽：','向听：','Shanten:'],
    ['Riichi discard:','立直切牌：','立直切牌：','Riichi discard:'],
    ['Start autoplay','啟動代打','启动代打','Start autoplay'],
    ['Stop autoplay','停止代打','停止代打','Stop autoplay'],
    ['Enable autoplay','啟用代打','启用代打','Enable autoplay'],
    ['Auto status: fallback','時間不足，使用目前的綠框建議','时间不足，使用当前的绿框建议','Short on time; using current highlighted recommendation'],
    ['Auto status: fallback_click','已點擊綠框，等待牌局確認','已点击绿框，等待牌局确认','Clicked highlight; awaiting game event'],
    ['Auto status: fallback_preparing','正在準備點擊綠框','正在准备点击绿框','Preparing highlight click'],
    ['Auto status: fallback_second_click','尚未送出切牌，正在確認選牌','尚未发送切牌，正在确认选牌','No discard sent yet; confirming the selected tile'],
    ['Auto status: fallback_submitted','遊戲已送出備援操作，等待牌局確認','游戏已发送备用操作，等待牌局确认','Game submitted the fallback; awaiting game event'],
    ['Auto status: fallback_input_failed','Chrome 未能送出綠框點擊','Chrome 未能发送绿框点击','Chrome could not send the highlight click'],
    ['Auto status: fallback_confirmed','綠框備援操作已確認','绿框备用操作已确认','Highlighted fallback confirmed'],
    ['Auto status: fallback_unconfirmed','綠框備援未獲確認','绿框备用操作未获确认','Highlighted fallback not confirmed'],
    ['Auto status: fallback_unavailable','無法確認綠框位置，未執行備援','无法确认绿框位置，未执行备用操作','Highlight could not be verified; fallback not sent'],
    ['Auto status: fallback_conflict','綠框備援結果不符','绿框备用结果不符','Highlighted fallback result did not match'],
    ['Auto status: manual','遊戲已送出操作，等待下一次決策','游戏已发送操作，等待下一次决策','Game submitted a move; waiting for next decision'],
    ['Auto status: awaiting_confirmation','等待遊戲確認','等待游戏确认','Awaiting game confirmation'],
    ['Auto status: response_unknown','無法解讀回覆，等待牌局確認','无法解读回复，等待牌局确认','Unrecognized response; awaiting game event'],
    ['Auto status: missed','本次決策已逾時，等待下一次操作','本次决策已超时，等待下一次操作','Decision missed; waiting for next action'],
    ['Auto status: confirmation_timeout','遊戲確認逾時，等待下一次決策','游戏确认超时，等待下一次决策','Confirmation timed out; waiting for next decision'],
    ['Auto status: send_failed','無法送出，等待下一次決策','无法发送，等待下一次决策','Send failed; waiting for next decision'],
    ['Auto status: state_changed','牌局狀態改變，等待同步','牌局状态改变，等待同步','Game state changed; waiting for sync'],
    ['Auto status: unresolved','無法確認此操作，等待下一次決策','无法确认此操作，等待下一次决策','Cannot resolve action; waiting for next decision'],
    ['Auto status: rejected','操作被拒絕，等待下一次決策','操作被拒绝，等待下一次决策','Action rejected; waiting for next decision'],
    ['Auto status: expired','操作逾時，等待下一次決策','操作超时，等待下一次决策','Action expired; waiting for next decision'],
    ['Auto status: conflict','遊戲結果不符，等待下一次決策','游戏结果不符，等待下一次决策','Unexpected result; waiting for next decision'],
    ['Auto status: scheduled','準備代打','准备代打','Autoplay scheduled'],
    ['Auto status: confirmed','操作已確認','操作已确认','Action confirmed'],
    ['Auto status: waiting','等待下一次操作','等待下一次操作','Waiting for next action'],
    ['Auto status: off','已關閉','已关闭','Off'],
    ['Demo mode','示範模式','演示模式','Demo mode'],
    ['危險牌：尚無對手立直','危險牌：尚無對手立直','危险牌：尚无对手立直','Danger: no opponent has declared riichi'],
    ['危險牌：無法確認手牌位置','危險牌：無法確認手牌位置','危险牌：无法确认手牌位置','Danger: cannot locate hand tiles'],
    ['危險牌功能需要更新橋接程式','危險牌功能需要更新橋接程式','危险牌功能需要更新桥接程序','Update the bridge for danger warnings'],
    ['危險牌：本手未達提示門檻','危險牌：本手未達提示門檻','危险牌：本手未达提示门槛','Danger: no tiles reached the warning threshold'],
    ['高風險：','高風險：','高风险：','High risk: '],['中風險：','中風險：','中风险：','Medium risk: '],
    ['下家','下家','下家','next player'],['對家','對家','对家','opposite player'],['上家','上家','上家','previous player'],
    ['立直','立直','立直',' riichi'],['多副露','多副露','多副露',' multiple calls'],['後段可能聽牌','後段可能聽牌','后段可能听牌',' late possible tenpai'],
    ['無筋','無筋','无筋','unsuji'],['半筋','半筋','半筋','half-suji'],['筋牌','筋牌','筋牌','suji'],
    ['字牌','字牌','字牌','honor'],['嵌張或邊張','嵌張或邊張','嵌张或边张','closed or edge wait'],
    ['單騎或雙碰','單騎或雙碰','单骑或双碰','single or pair wait'],['只剩單騎','只剩單騎','只剩单骑','single wait'],
    ['寶牌','寶牌','宝牌','dora']
  ];
  const sorted = entries.slice().sort((a,b) => b[0].length - a[0].length);
  let language = 'zh-Hant';
  let root, observer, selector, changed = false;
  const originals = new WeakMap();
  function translate(value, lang = language) {
    const column = lang === 'zh-Hans' ? 2 : lang === 'en' ? 3 : 1;
    // Match against the source once so translated words are never translated again.
    let output = '';
    for (let i = 0; i < value.length;) {
      const match = sorted.find(entry => value.startsWith(entry[0], i));
      if (match) { output += match[column] ?? match[0]; i += match[0].length; }
      else { output += value[i]; i++; }
    }
    return output;
  }
  function visit(node) {
    if (node.nodeType === 3) {
      const previous = originals.get(node);
      const original = previous && node.nodeValue === previous.rendered ? previous.original : node.nodeValue;
      const rendered = translate(original || '');
      originals.set(node, {original, rendered});
      if (node.nodeValue !== rendered) node.nodeValue = rendered;
    } else if (node.nodeType === 1) {
      if (node === selector) return;
      for (const key of ['title','aria-label']) {
        const current = node.getAttribute(key);
        if (current === null) continue;
        let values = originals.get(node) || {};
        const prev = values[key];
        const original = prev && current === prev.rendered ? prev.original : current;
        const rendered = translate(original);
        values[key] = {original, rendered}; originals.set(node, values);
        if (current !== rendered) node.setAttribute(key, rendered);
      }
      for (const child of node.childNodes) visit(child);
    }
  }
  function refresh() {
    if (!root) return;
    observer?.disconnect(); visit(root);
    observer?.observe(root, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label']});
  }
  function create(card, controls = card) {
    root = card;
    const label = document.createElement('label');
    Object.assign(label.style, {display:'block',marginTop:'8px',pointerEvents:'auto'});
    label.textContent = '語言 / 语言 / Language ';
    selector = document.createElement('select');
    selector.setAttribute('aria-label','Language');
    for (const [value, name] of [['zh-Hant','繁體中文'],['zh-Hans','简体中文'],['en','English']]) {
      const option=document.createElement('option'); option.value=value; option.textContent=name; selector.append(option);
    }
    label.append(selector); controls.append(label);
    selector.addEventListener('change', () => {
      changed = true; language = selector.value;
      try { chrome.storage.local.set({hudLanguage:language}); } catch (_) {}
      refresh();
    });
    observer = new MutationObserver(refresh); refresh();
    try { chrome.storage.local.get('hudLanguage', result => {
      if (changed) return;
      language = ['zh-Hant','zh-Hans','en'].includes(result?.hudLanguage) ? result.hudLanguage : 'zh-Hant';
      selector.value=language; refresh();
    }); } catch (_) {}
  }
  globalThis.MjaiI18n = {create, translate};
})();
