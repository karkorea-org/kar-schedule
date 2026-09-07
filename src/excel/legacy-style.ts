// @ts-nocheck
// V1 compatibility extraction. Original legacy HTML remains unchanged.
import * as fflate from "fflate";
export function buildMceStyleMap(arrayBuffer){
    if (typeof fflate === 'undefined') return null;
    try {
      const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
      const td = new TextDecoder('utf-8');
      const parser = new DOMParser();
      const NSX = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const NSMC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
      const NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

      const stylesBytes = files['xl/styles.xml'];
      if (!stylesBytes) return null;
      const sDoc = parser.parseFromString(td.decode(stylesBytes), 'application/xml');

      // fills
      const fills = [];
      const fillsNode = sDoc.getElementsByTagNameNS(NSX, 'fills')[0];
      if (fillsNode){
        for (const fe of fillsNode.children){
          if (fe.localName !== 'fill'){ fills.push(null); continue; }
          const pf = fe.getElementsByTagNameNS(NSX, 'patternFill')[0];
          if (!pf){ fills.push(null); continue; }
          const fg = pf.getElementsByTagNameNS(NSX, 'fgColor')[0];
          fills.push(fg ? fg.getAttribute('rgb') : null);
        }
      }

      // cellStyleXfs (상속용)
      const csxfList = [];
      const csxfsNode = sDoc.getElementsByTagNameNS(NSX, 'cellStyleXfs')[0];
      if (csxfsNode){
        for (const child of csxfsNode.children){
          if (child.localName === 'xf') csxfList.push(child);
          else if (child.localName === 'AlternateContent'){
            const c = child.getElementsByTagNameNS(NSMC, 'Choice')[0];
            const fb = child.getElementsByTagNameNS(NSMC, 'Fallback')[0];
            const target = c || fb;
            if (target){
              const xf = target.getElementsByTagNameNS(NSX, 'xf')[0];
              if (xf) csxfList.push(xf);
            }
          }
        }
      }

      // cellXfs (MCE-aware, Choice 우선)
      const xfList = [];
      const cellXfsNode = sDoc.getElementsByTagNameNS(NSX, 'cellXfs')[0];
      if (cellXfsNode){
        for (const child of cellXfsNode.children){
          if (child.localName === 'xf') xfList.push(child);
          else if (child.localName === 'AlternateContent'){
            const c = child.getElementsByTagNameNS(NSMC, 'Choice')[0];
            const fb = child.getElementsByTagNameNS(NSMC, 'Fallback')[0];
            const target = c || fb;
            if (target){
              const xf = target.getElementsByTagNameNS(NSX, 'xf')[0];
              if (xf) xfList.push(xf);
            }
          }
        }
      }

      function xfToColor(xf){
        const applyFillAttr = xf.getAttribute('applyFill');
        const applyFill = applyFillAttr === '1';
        const fillId = parseInt(xf.getAttribute('fillId') || '0', 10);
        // applyFill 명시되어 있고 true이거나, 속성 생략되었고 fillId>1이면 fill 사용
        const hasFill = applyFill || (applyFillAttr == null && fillId > 1);
        if (hasFill && fills[fillId]) return fills[fillId];
        // 상속: xfId가 가리키는 cellStyleXf의 fill
        const xfId = parseInt(xf.getAttribute('xfId') || '0', 10);
        if (xfId > 0 && xfId < csxfList.length){
          const parent = csxfList[xfId];
          const pFillId = parseInt(parent.getAttribute('fillId') || '0', 10);
          if (pFillId > 1 && fills[pFillId]) return fills[pFillId];
        }
        return null;
      }

      // workbook.xml + rels로 sheetName → xml 경로 매핑
      const sheetPathMap = {};
      const wbBytes = files['xl/workbook.xml'];
      const wbRelsBytes = files['xl/_rels/workbook.xml.rels'];
      if (wbBytes && wbRelsBytes){
        const wbDoc = parser.parseFromString(td.decode(wbBytes), 'application/xml');
        const relsDoc = parser.parseFromString(td.decode(wbRelsBytes), 'application/xml');
        const relMap = {};
        for (const rel of relsDoc.getElementsByTagName('Relationship')){
          relMap[rel.getAttribute('Id')] = rel.getAttribute('Target');
        }
        for (const sheet of wbDoc.getElementsByTagNameNS(NSX, 'sheet')){
          const name = sheet.getAttribute('name');
          const rid = sheet.getAttributeNS(NSR, 'id') || sheet.getAttribute('r:id');
          const target = relMap[rid];
          if (name && target){
            const full = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
            sheetPathMap[name] = full;
          }
        }
      }

      // 시트별 cellRef → hex color 맵 구축
      const sheetColorMap = {};
      for (const name of Object.keys(sheetPathMap)){
        const bytes = files[sheetPathMap[name]];
        if (!bytes) continue;
        const shDoc = parser.parseFromString(td.decode(bytes), 'application/xml');
        const cells = shDoc.getElementsByTagNameNS(NSX, 'c');
        const m = {};
        for (const c of cells){
          const ref = c.getAttribute('r');
          const sAttr = c.getAttribute('s');
          if (!ref || !sAttr) continue;
          const idx = parseInt(sAttr, 10);
          if (!Number.isFinite(idx) || idx < 0 || idx >= xfList.length) continue;
          const color = xfToColor(xfList[idx]);
          if (!color) continue;
          const clean = color.length === 8 ? color.slice(2) : color;
          m[ref] = clean.toUpperCase();
        }
        sheetColorMap[name] = m;
      }
      return sheetColorMap;
    } catch(err){
      console.warn('MCE style map build failed:', err);
      return null;
    }
  }

  const MAX_THEME_XML_BYTES = 2 * 1024 * 1024;
  const COMPACT_OFFICE_THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="新細明體"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

export function sanitizeWorkbookForXlsxRead(arrayBuffer){
    if (!arrayBuffer || typeof fflate === 'undefined') return arrayBuffer;
    try {
      const files = fflate.unzipSync(new Uint8Array(arrayBuffer));
      const encoder = new TextEncoder();
      let changed = false;
      Object.keys(files).forEach(path => {
        if (/^xl\/theme\/theme\d+\.xml$/i.test(path) && files[path].length > MAX_THEME_XML_BYTES){
          files[path] = encoder.encode(COMPACT_OFFICE_THEME_XML);
          changed = true;
        }
      });
      return changed ? fflate.zipSync(files, { level: 6 }) : arrayBuffer;
    } catch(err){
      console.warn('Workbook theme sanitize failed:', err);
      return arrayBuffer;
    }
  }

