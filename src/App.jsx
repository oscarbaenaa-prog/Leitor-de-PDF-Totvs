import { useState, useRef, useEffect } from "react";

function usePdfJs() {
  const [ready, setReady] = useState(!!window.pdfjsLib);
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setReady(true);
    };
    document.head.appendChild(s);
  }, []);
  return ready;
}

const ADDR_BASE    = "AV. DR. ULYSSES GUIMARÃES, 4105 - VILA NOGUEIRA - DIADEMA - SP, 09990-080";
const HORARIO_BASE = "SEG À SEX DAS 09:00 ÀS 12:00 E DAS 13:00 ÀS 16:00";
const EMITENTE     = "20.300.907/0001-83 - ARKOS BRASIL PROJETOS LTDA";

const BLANK_FORM = {
  num_pedido:"", valor_nf:"", descricao:"", cliente:"", cnpj_cli:"",
  contato_cli:"", end_entrega:"", obs_esp:"",
  end_coleta_c:"", horario_c: HORARIO_BASE, contato_log:"",
};

const BLANK_MAT = { vol:"", peso:"", l:"", a:"", c:"", unit:"cm" };

function parseTexto(txt) {
  const raw = txt.replace(/[ \t]+/g, " ");
  const get = (re) => { const m = raw.match(re); return m ? m[1].trim() : ""; };

  // ── Número do pedido ──────────────────────────────────────────────
  const num_pedido =
    get(/Pedido de Venda\s+([\w_-]+)/i) ||
    get(/P\.?\s*I\s+([0-9]+)/i) || "";

  // ── Valor NF ──────────────────────────────────────────────────────
  // Só aceita formato monetário brasileiro (termina em ,XX)
  const valor_nf = (() => {
    const m = raw.match(/Total\s+Final\s+([\d.]+,\d{2})/i);
    if (m) return "R$ " + m[1];
    // fallback: maior valor após "Total Final"
    const m2 = raw.match(/Total\s+Final([\s\S]{0,80})/i);
    if (!m2) return "";
    const nums = [...m2[1].matchAll(/([\d.]+,\d{2})/g)]
      .map(n => ({ str: n[1], val: parseFloat(n[1].replace(/\./g,"").replace(",",".")) }))
      .filter(n => !isNaN(n.val) && n.val > 0);
    return nums.length ? "R$ " + nums.reduce((a,b) => b.val > a.val ? b : a).str : "";
  })();

  // ── Cliente ───────────────────────────────────────────────────────
  // Formato antigo: "Cliente: MR2 PRINT..." (valor logo após rótulo)
  // Formato novo:   rótulos ficam vazios, valores vêm depois agrupados
  //                 "Cliente: Cpf/Cnpj: ... UF: RAFAEL BARRETO RIBEIRO ISENTO"
  const cliente = (() => {
    // Tenta formato antigo mas valida que o resultado NÃO é um rótulo
    const m1 = raw.match(/Cliente:\s+(.+?)\s+(?:Rg\/Ie|Cpf\/Cnpj|Endere[çc]o)/i);
    if (m1) {
      const v = m1[1].trim();
      // Se capturou um rótulo (ex: "Cpf/Cnpj:"), é formato novo — ignora
      if (!/Cpf|Cnpj|Endere|Telefon|E-mail|Vendedor|Rg/i.test(v)) return v.toUpperCase();
    }
    // Formato novo: nome vem após UF (2 letras) e antes de ISENTO ou número
    const m2 = raw.match(/UF:\s+([A-Z][A-Z\s]{3,50}?)\s+(?:ISENTO|[\d]{3}[.\-])/i);
    if (m2) return m2[1].trim().toUpperCase();
    // Fallback: entre CEP numérico e "Forma de pagto"
    const m3 = raw.match(/\d{5}-\d{3}\s+[A-Z]{2}\s+([A-Z][A-Z\s]{3,50}?)\s+(?:ISENTO|Forma)/i);
    if (m3) return m3[1].trim().toUpperCase();
    return "";
  })();

  // ── CPF / CNPJ ────────────────────────────────────────────────────
  // Formato antigo: "Cpf/Cnpj: 20.148.251/0001-25" (com rótulo)
  // Formato novo:   "01222681641" (sem rótulo, aparece antes da linha de produto)
  const cnpj_cli = (() => {
    // Com rótulo
    const m1 = raw.match(/Cpf\/Cnpj:\s*([\d][^\s]{8,18})/i);
    if (m1) return m1[1].trim();
    // CPF 11 dígitos sem formatação (formato novo)
    const m2 = raw.match(/\b(\d{11})\b/);
    if (m2) {
      const d = m2[1];
      return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
    }
    return "";
  })();

  // ── Contato ───────────────────────────────────────────────────────
  const contato_cli = (() => {
    const m1 = raw.match(/Telefones?:\s*(\(\d{2}\)[\d\s()-]{7,15})(?:\s+(?:Contato|Fax))/i);
    if (m1) return m1[1].trim();
    const m2 = raw.match(/Contato:[^\n\r(]{0,40}(\(\d{2}\)\s*[\d][\d\s-]{7,11})/i);
    if (m2) return m2[1].trim();
    // Formato novo: "Contato do responsavel: (54) 999570404"
    const m3 = raw.match(/Contato\s+do\s+respons[aá]vel[:\s]+([^\n\r]{5,25})/i);
    if (m3) return m3[1].trim();
    return "";
  })();

  // ── Descrição ─────────────────────────────────────────────────────
  // Formato antigo: QTD COD DESC ... NUM NUM NUM NUM
  // Formato novo:   QTD COD DESC DATA(DD/MM/YYYY) NUM NUM%
  const descricao = (() => {
    const linhas = [];
    // Formato novo (com data de previsão)
    const reNovo = /\b(\d+)\s+(\d+)\s+([A-Z][A-Z0-9 ,.\-\/]{5,}?)\s+\d{2}\/\d{2}\/\d{4}\s+[\d.,]+/gi;
    let m;
    while ((m = reNovo.exec(raw)) !== null) {
      const desc = m[3].trim();
      if (/sub\s*total|frete|total|desc%|unitario|unit\s*final|codigo|descri[çc]|previs/i.test(desc)) continue;
      if (desc.length < 5) continue;
      linhas.push(`${m[1]}x ${desc}`);
    }
    if (linhas.length) return linhas.join(" | ");
    // Formato antigo (sem data)
    const reAntigo = /[\d.,]+\s+([A-Z][A-Z0-9 ,.\-\/]{5,}?)\s+(\d+)\s+([A-Z][A-Z0-9]{3,})/g;
    while ((m = reAntigo.exec(raw)) !== null) {
      const desc = m[1].trim();
      const qtd  = m[2];
      if (/sub\s*total|frete|total|desc%|unitario|unit\s*final|codigo|descri[çc]/i.test(desc)) continue;
      if (desc.length < 5) continue;
      linhas.push(`${qtd}x ${desc}`);
    }
    return linhas.join(" | ");
  })();

  // ── Endereço de Entrega ───────────────────────────────────────────
  // Formato antigo: valor vem ANTES do rótulo (Fax: ENDEREÇO End. Entrega:)
  // Formato novo:   rótulos juntos + forma pagto + end. entrega tudo na mesma sequência
  //                 "End. Entrega: BOLETO ITAU 30/60/90/120 DIAS AV AV DOUTOR..."
  //                 O endereço real vem após "DIAS"
  const end_entrega = (() => {
    // Formato antigo: valor antes do rótulo
    const m1 = raw.match(/Fax:\s+(.+?)\s+End\.\s*Entrega:/i);
    if (m1 && m1[1].trim().length > 5) return m1[1].trim();
    // Formato novo: endereço após "DIAS" (forma de pagto misturada)
    const m2 = raw.match(/\d+\s+DIAS?\s+([A-Z].+?)\s+(?:PRODUTOS|Qtde|PRODUTO)/i);
    if (m2 && m2[1].trim().length > 5) return m2[1].trim();
    // Fallback direto após End. Entrega: (se não tiver forma pagto na frente)
    const m3 = raw.match(/End\.\s*Entrega:\s+([^T][^\n\r]{8,200}?)(?=\s+(?:Transportadora|Pedido de Venda|PRODUTOS))/i);
    if (m3 && m3[1].trim().length > 5) return m3[1].trim();
    return "";
  })();

  return { num_pedido, valor_nf, descricao, cliente, cnpj_cli, contato_cli, end_entrega };
}

const css = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0f11}
  .root{background:#0d0f11;min-height:100vh;font-family:'IBM Plex Sans',sans-serif;color:#e8eaed}
  .hdr{border-bottom:1px solid #2a2e33;padding:14px 24px;display:flex;align-items:center;gap:10px;background:#0d0f11;position:sticky;top:0;z-index:50}
  .logo{width:28px;height:28px;background:#f0c040;border-radius:5px;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:11px;color:#000}
  .htitle{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;letter-spacing:.06em}
  .hsub{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#5f6671}
  .main{max-width:660px;margin:0 auto;padding:32px 18px 80px}
  .dz{border:1.5px dashed #363b41;border-radius:12px;padding:48px 20px;text-align:center;cursor:pointer;background:#141618;transition:all .2s}
  .dz:hover,.dz.drag{border-color:#f0c040;background:#1a1900}
  .dz-icon{font-size:30px;margin-bottom:10px}
  .dz p{font-size:14px;font-weight:500;margin-bottom:5px}
  .dz span{font-size:12px;color:#5f6671;font-family:'IBM Plex Mono',monospace}
  .pill{display:flex;align-items:center;gap:8px;padding:9px 13px;background:#141618;border:1px solid #2a2e33;border-radius:7px;font-size:12px;margin-bottom:14px;font-family:'IBM Plex Mono',monospace}
  .pill-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .badge{font-size:10px;padding:2px 8px;border-radius:20px;font-family:'IBM Plex Mono',monospace;font-weight:600;white-space:nowrap}
  .b-ok{background:#0d2a1c;color:#34c97b;border:1px solid #1e5c3a}
  .b-warn{background:#261a0d;color:#f0a040;border:1px solid #5c3a1e}
  .sbar{display:flex;align-items:center;gap:8px;font-size:12px;color:#9aa0a8;font-family:'IBM Plex Mono',monospace;padding:2px 0 12px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner{width:12px;height:12px;border:1.5px solid #2a2e33;border-top-color:#f0c040;border-radius:50%;animation:spin .7s linear infinite}
  .slabel{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#5f6671;letter-spacing:.12em;text-transform:uppercase;margin-bottom:9px;display:flex;align-items:center;gap:8px}
  .slabel::after{content:'';flex:1;height:1px;background:#2a2e33}
  .card{background:#141618;border:1px solid #2a2e33;border-radius:10px;padding:15px 17px;margin-bottom:10px}
  .ctitle{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#5f6671;text-transform:uppercase;letter-spacing:.1em;margin-bottom:13px;display:flex;align-items:center;justify-content:space-between}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:9px}
  .g1{display:grid;grid-template-columns:1fr;gap:9px;margin-bottom:9px}
  .g2:last-child,.g1:last-child{margin-bottom:0}
  .fld label{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;color:#5f6671;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .fld input,.fld textarea{width:100%;padding:7px 10px;font-size:13px;border:1px solid #2a2e33;border-radius:6px;background:#1c1f23;color:#e8eaed;font-family:'IBM Plex Sans',sans-serif;outline:none;transition:border-color .15s}
  .fld input:focus,.fld textarea:focus{border-color:#f0c040}
  .fld input.ai{background:#1c1900;border-color:#c99a1a}
  .fld textarea{resize:vertical;min-height:52px;line-height:1.5}
  .togrow{display:flex;gap:7px;margin-bottom:9px}
  .tbtn{flex:1;padding:7px 10px;font-size:12px;font-weight:500;font-family:'IBM Plex Mono',monospace;border-radius:6px;cursor:pointer;border:1px solid #2a2e33;background:#1c1f23;color:#5f6671;transition:all .15s}
  .tbtn.on{background:#f0c040;color:#000;border-color:#f0c040;font-weight:700}
  .addr-ok{background:#0d2a1c;border:1px solid #1e5c3a;border-radius:7px;padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.8;color:#34c97b}
  .addr-warn{background:#261a0d;border:1px solid #5c3a1e;border-radius:7px;padding:8px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#f0a040;margin-bottom:9px}
  .mat-row{background:#1c1f23;border:1px solid #2a2e33;border-radius:8px;padding:12px 14px;margin-bottom:8px}
  .mat-row:last-of-type{margin-bottom:0}
  .mat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .mat-label{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#5f6671;text-transform:uppercase;letter-spacing:.08em}
  .mat-hint{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#34c97b;background:#0d2a1c;border:1px solid #1e5c3a;border-radius:5px;padding:5px 9px;margin-top:8px}
  .mat-gdim{display:grid;grid-template-columns:60px 1fr 1fr 1fr;gap:7px;align-items:end}
  .mat-g2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px}
  .btn-del{background:none;border:1px solid #3a2020;border-radius:5px;color:#f05050;font-size:12px;cursor:pointer;padding:3px 8px;font-family:'IBM Plex Mono',monospace;transition:all .15s}
  .btn-del:hover{background:#2a0d0d}
  .btn-add{background:none;border:1px dashed #363b41;border-radius:7px;padding:9px;font-size:12px;cursor:pointer;color:#9aa0a8;font-family:'IBM Plex Mono',monospace;width:100%;margin-top:8px;transition:all .15s;text-align:center}
  .btn-add:hover{border-color:#f0c040;color:#f0c040}
  .utog{display:flex;border:1px solid #2a2e33;border-radius:6px;overflow:hidden;height:34px;align-self:end}
  .ubtn{flex:1;border:none;background:#1c1f23;color:#5f6671;font-size:11px;font-weight:600;cursor:pointer;font-family:'IBM Plex Mono',monospace;transition:all .15s}
  .ubtn.on{background:#f0c040;color:#000}
  .errbanner{background:#2a0d0d;border:1px solid #5c1e1e;border-radius:7px;padding:9px 13px;margin-bottom:11px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#f05050}
  .infobanner{background:#0d1a2a;border:1px solid #1e3a5c;border-radius:7px;padding:9px 13px;margin-bottom:11px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#7ab8f5;line-height:1.6}
  .genbtn{background:#f0c040;color:#000;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;width:100%;margin-top:4px;font-family:'IBM Plex Mono',monospace;letter-spacing:.02em;transition:opacity .15s}
  .genbtn:hover{opacity:.85}
  .divider{border:none;border-top:1px solid #2a2e33;margin:22px 0}
  .outhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
  .outlbl{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#9aa0a8;letter-spacing:.1em;text-transform:uppercase}
  .outbox{background:#141618;border:1px solid #2a2e33;border-left:3px solid #f0c040;border-radius:9px;padding:16px 18px;font-size:13px;line-height:2;white-space:pre-wrap;font-family:'IBM Plex Mono',monospace;color:#e8eaed}
  .btnrow{display:flex;gap:7px;margin-top:11px;flex-wrap:wrap}
  .sbtn{background:#141618;border:1px solid #2a2e33;border-radius:6px;padding:7px 13px;font-size:12px;cursor:pointer;color:#e8eaed;font-family:'IBM Plex Mono',monospace;font-weight:500;transition:all .15s}
  .sbtn:hover{border-color:#f0c040;color:#f0c040}
`;


function F({ label, id, value, onChange, ai, placeholder, type="text" }) {
  return (
    <div className="fld">
      <label>{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        className={ai ? "ai" : ""}
        onChange={e => onChange(id, e.target.value)} />
    </div>
  );
}

function MatRow({ mat, idx, total, onChange, onRemove }) {
  const u = mat.unit.toUpperCase();
  const l = parseFloat(mat.l), a = parseFloat(mat.a), c = parseFloat(mat.c), v = parseInt(mat.vol);
  const hint = l && a && c ? `✓ L${mat.l}${u} x A${mat.a}${u} x C${mat.c}${u} por volume${v > 1 ? ` — ${v} volumes` : ""}` : "";

  return (
    <div className="mat-row">
      <div className="mat-header">
        <span className="mat-label">Material {idx + 1}</span>
        {total > 1 && <button className="btn-del" onClick={() => onRemove(idx)}>✕ remover</button>}
      </div>
      <div className="mat-g2">
        <div className="fld">
          <label>Nº de volumes</label>
          <input type="number" value={mat.vol} placeholder="ex: 45" onChange={e => onChange(idx, "vol", e.target.value)} />
        </div>
        <div className="fld">
          <label>Peso (kg)</label>
          <input type="number" value={mat.peso} placeholder="ex: 220" onChange={e => onChange(idx, "peso", e.target.value)} />
        </div>
      </div>
      <div className="mat-gdim">
        <div className="fld">
          <label>Un.</label>
          <div className="utog">
            <button className={`ubtn${mat.unit==="cm"?" on":""}`} onClick={() => onChange(idx, "unit", "cm")}>cm</button>
            <button className={`ubtn${mat.unit==="m"?" on":""}`} onClick={() => onChange(idx, "unit", "m")}>m</button>
          </div>
        </div>
        <div className="fld">
          <label>Largura ({mat.unit})</label>
          <input type="number" value={mat.l} placeholder="ex: 14" onChange={e => onChange(idx, "l", e.target.value)} />
        </div>
        <div className="fld">
          <label>Altura ({mat.unit})</label>
          <input type="number" value={mat.a} placeholder="ex: 12" onChange={e => onChange(idx, "a", e.target.value)} />
        </div>
        <div className="fld">
          <label>Comprimento ({mat.unit})</label>
          <input type="number" value={mat.c} placeholder="ex: 290" onChange={e => onChange(idx, "c", e.target.value)} />
        </div>
      </div>
      {hint && <div className="mat-hint">{hint}</div>}
    </div>
  );
}

export default function App() {
  const pdfReady   = usePdfJs();
  const [stage, setStage]       = useState("upload");
  const [status, setStatus]     = useState("");
  const [fileName, setFileName] = useState("");
  const [badge, setBadge]       = useState({ state:"", text:"" });
  const [aiFields, setAiFields] = useState({});
  const [form, setForm]         = useState(BLANK_FORM);
  const [mats, setMats]         = useState([{ ...BLANK_MAT }]);
  const [coleta, setColeta]     = useState("base");
  const [output, setOutput]     = useState("");
  const [copied, setCopied]     = useState(false);
  const [drag, setDrag]         = useState(false);
  const [error, setError]       = useState("");
  const [pdfText, setPdfText]   = useState("");
  const [pdfPreview, setPdfPreview] = useState("");
  const fileRef = useRef();

  const upd = (id, val) => setForm(f => ({ ...f, [id]: val }));

  const updMat = (idx, key, val) => setMats(ms => ms.map((m,i) => i===idx ? {...m,[key]:val} : m));
  const addMat = () => setMats(ms => [...ms, { ...BLANK_MAT }]);
  const delMat = (idx) => setMats(ms => ms.filter((_,i) => i!==idx));

  async function processFile(file) {
    if (file.type !== "application/pdf") { setError("Selecione um arquivo PDF."); return; }
    if (!pdfReady) { setError("PDF.js ainda carregando, aguarde."); return; }
    setFileName(file.name); setError("");
    setStage("form"); setStatus("Lendo PDF...");
    setBadge({ state:"warn", text:"lendo..." });
    try {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      setPdfText(text);
      setStatus("");
      if (text.trim().length < 30) {
        // PDF sem texto — renderiza como imagem para o usuário ver
        setBadge({ state:"warn", text:"preencha manualmente" });
        try {
          const page = await window.pdfjsLib.getDocument({ data: buf }).promise.then(p => p.getPage(1));
          const vp = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          setPdfPreview(canvas.toDataURL("image/jpeg", 0.85));
        } catch(e) { /* sem preview */ }
        return;
      }
      const ex = parseTexto(text);
      const filled = {};
      Object.entries(ex).forEach(([k,v]) => { if (v) filled[k] = true; });
      setAiFields(filled);
      setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(ex).filter(([,v])=>v)) }));
      const n = Object.values(filled).filter(Boolean).length;
      setBadge({ state: n >= 3 ? "ok" : "warn", text: n >= 3 ? `✓ ${n} campos extraídos` : "poucos dados — verifique" });
    } catch(e) {
      setStatus(""); setBadge({ state:"warn", text:"erro ao ler PDF" });
      setError("Erro: " + e.message);
    }
  }

  function gerar() {
    const g = k => form[k] || "";
    const endColeta = coleta === "base" ? ADDR_BASE : g("end_coleta_c");
    const horario   = coleta === "base" ? HORARIO_BASE : g("horario_c");

    // Totais agregados
    const totalVol  = mats.reduce((s,m) => s + (parseInt(m.vol)||0), 0);
    const totalPeso = mats.reduce((s,m) => s + (parseFloat(m.peso)||0), 0);

    // Linhas de dimensão por material
    const dimLinhas = mats
      .filter(m => m.l && m.a && m.c)
      .map(m => {
        const u = m.unit.toUpperCase();
        const v = parseInt(m.vol);
        return `DIMENSÕES: L${m.l}${u} x A${m.a}${u} x C${m.c}${u} (por volume)${v > 1 ? ` — ${v} VOLUMES` : ""}`;
      });

    const linhas = [
      `PEDIDO: ${g("num_pedido")}`,
      `Cliente: ${g("cliente")}`,
      `CNPJ DO EMITENTE: ${EMITENTE}`,
      `Cpf/Cnpj: ${g("cnpj_cli")}`,
      totalVol  > 0 ? `QUANTIDADE TOTAL: ${totalVol} VOLUME${totalVol > 1 ? "S" : ""}` : null,
      ...dimLinhas,
      totalPeso > 0 ? `PESO TOTAL: ${totalPeso.toFixed(totalPeso % 1 === 0 ? 0 : 1)} KG` : null,
      `VALOR NF: ${g("valor_nf")}`,
      `END. COLETA: ${endColeta}`,
      `HORÁRIO: ${horario}`,
      `END. ENTREGA: ${g("end_entrega")}`,
      g("obs_esp") || null,
    ].filter(Boolean);

    setOutput(linhas.join("\n"));
    setStage("output");
  }

  function copiar() {
    navigator.clipboard.writeText(output).then(() => { setCopied(true); setTimeout(()=>setCopied(false),2000); });
  }

  function reset() {
    setStage("upload"); setForm(BLANK_FORM); setAiFields({});
    setMats([{ ...BLANK_MAT }]);
    setOutput(""); setFileName(""); setBadge({state:"",text:""});
    setStatus(""); setError(""); setPdfText(""); setPdfPreview(""); setColeta("base");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <style>{css}</style>
      <div className="root">
        <header className="hdr">
          <div className="logo">AK</div>
          <span className="htitle">GERADOR DE FRETE</span>
          <span className="hsub">Arkos Brasil Projetos</span>
        </header>
        <div className="main">

          {stage === "upload" && (
            <>
              {error && <div className="errbanner">⚠ {error}</div>}
              <div className="slabel">Upload do pedido</div>
              <div className={`dz${drag?" drag":""}`}
                onClick={()=>fileRef.current.click()}
                onDragOver={e=>{e.preventDefault();setDrag(true);}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);}}>
                <div className="dz-icon">📄</div>
                <p>Arraste o Pedido de Venda em PDF</p>
                <span>ou clique para selecionar · extração automática de campos</span>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}}
                onChange={e=>{if(e.target.files[0])processFile(e.target.files[0]);}}/>
            </>
          )}

          {(stage === "form" || stage === "output") && (
            <>
              <div className="pill">
                <span>📄</span>
                <span className="pill-name">{fileName}</span>
                {badge.state && <span className={`badge ${badge.state==="ok"?"b-ok":"b-warn"}`}>{badge.text}</span>}
              </div>
              {status && <div className="sbar"><div className="spinner"/><span>{status}</span></div>}
              {error  && <div className="errbanner">⚠ {error}</div>}

              {stage === "form" && (
                <>
                  {pdfPreview && (
                    <div style={{marginBottom:12}}>
                      <div className="slabel">Prévia do pedido</div>
                      <div style={{background:"#141618",border:"1px solid #2a2e33",borderRadius:10,overflow:"hidden",maxHeight:420,overflowY:"auto"}}>
                        <img src={pdfPreview} style={{width:"100%",display:"block"}} alt="PDF preview"/>
                      </div>
                      <div className="infobanner" style={{marginTop:8,marginBottom:0}}>ℹ PDF sem texto extraível. Use a prévia acima para preencher os campos manualmente.</div>
                    </div>
                  )}
                  {!pdfPreview && pdfText && Object.values(aiFields).filter(Boolean).length < 3 && (
                    <div className="infobanner">ℹ Poucos campos detectados. Preencha os campos em branco antes de gerar.</div>
                  )}

                  <div className="slabel">Dados do pedido</div>

                  <div className="card">
                    <div className="ctitle"><span>📋 Pedido</span></div>
                    <div className="g2">
                      <F label="Pedido Nº" id="num_pedido" value={form.num_pedido} onChange={upd} ai={aiFields.num_pedido}/>
                      <F label="Valor total NF" id="valor_nf" value={form.valor_nf} onChange={upd} ai={aiFields.valor_nf}/>
                    </div>
                    <div className="g1">
                      <F label="Descrição do produto" id="descricao" value={form.descricao} onChange={upd} ai={aiFields.descricao}/>
                    </div>
                  </div>

                  <div className="card">
                    <div className="ctitle"><span>👤 Destinatário</span></div>
                    <div className="g1"><F label="Nome do cliente" id="cliente" value={form.cliente} onChange={upd} ai={aiFields.cliente}/></div>
                    <div className="g2">
                      <F label="CNPJ do cliente" id="cnpj_cli" value={form.cnpj_cli} onChange={upd} ai={aiFields.cnpj_cli}/>
                      <F label="Contato" id="contato_cli" value={form.contato_cli} onChange={upd} ai={aiFields.contato_cli}/>
                    </div>
                    <div className="g1"><F label="Endereço de entrega" id="end_entrega" value={form.end_entrega} onChange={upd} ai={aiFields.end_entrega}/></div>
                  </div>

                  <div className="card">
                    <div className="ctitle"><span>📍 Endereço de coleta</span></div>
                    <div className="togrow">
                      <button className={`tbtn${coleta==="base"?" on":""}`} onClick={()=>setColeta("base")}>🏭 Base Arkos (padrão)</button>
                      <button className={`tbtn${coleta==="outro"?" on":""}`} onClick={()=>setColeta("outro")}>✏️ Outro endereço</button>
                    </div>
                    {coleta==="base" ? (
                      <div className="addr-ok"><strong>{ADDR_BASE}</strong><br/><span style={{opacity:.8,fontSize:10}}>{HORARIO_BASE}</span></div>
                    ) : (
                      <>
                        <div className="addr-warn">⚠ Endereço diferente da base Arkos</div>
                        <div className="g1"><F label="Endereço de coleta" id="end_coleta_c" value={form.end_coleta_c} onChange={upd} placeholder="Rua, nº — Bairro — Cidade — UF, CEP"/></div>
                        <div className="g2">
                          <F label="Horário" id="horario_c" value={form.horario_c} onChange={upd}/>
                          <F label="Contato logística" id="contato_log" value={form.contato_log} onChange={upd}/>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="card">
                    <div className="ctitle">
                      <span>📦 Volumes, dimensões e peso</span>
                    </div>

                    {mats.map((mat, idx) => (
                      <MatRow key={idx} mat={mat} idx={idx} total={mats.length}
                        onChange={updMat} onRemove={delMat} />
                    ))}

                    <button className="btn-add" onClick={addMat}>
                      + Adicionar material
                    </button>

                    <div className="g1" style={{marginTop:12}}>
                      <div className="fld">
                        <label>Obs. especiais</label>
                        <textarea value={form.obs_esp} onChange={e=>upd("obs_esp",e.target.value)}
                          placeholder="ex: NECESSÁRIO MÃO DE OBRA PARA DESCARGA"/>
                      </div>
                    </div>
                  </div>

                  <button className="genbtn" onClick={gerar}>✦ Gerar texto do pedido de frete</button>
                </>
              )}

              {stage === "output" && (
                <>
                  <hr className="divider"/>
                  <div className="outhdr">
                    <span className="outlbl">Texto do pedido</span>
                    <span className="badge b-ok">✓ pronto para enviar</span>
                  </div>
                  <div className="outbox">{output}</div>
                  <div className="btnrow">
                    <button className="sbtn" onClick={copiar}>{copied?"✓ Copiado!":"⎘ Copiar"}</button>
                    <button className="sbtn" onClick={()=>setStage("form")}>✏ Editar</button>
                    <button className="sbtn" onClick={reset}>↺ Novo pedido</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
