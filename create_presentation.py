import sys
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def create_deck(output_path):
    prs = Presentation()
    # 16:9 Widescreen layout
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Dark Color Palette matching the App
    BG_DARK = RGBColor(13, 17, 23)          # #0d1117
    CARD_BG = RGBColor(22, 27, 34)          # #161b22
    CARD_BORDER = RGBColor(48, 54, 61)      # #30363d
    ACCENT_BLUE = RGBColor(59, 130, 246)    # #3b82f6
    ACCENT_PURPLE = RGBColor(168, 85, 247)  # #a855f7
    ACCENT_EMERALD = RGBColor(16, 185, 129) # #10b981
    ACCENT_AMBER = RGBColor(245, 158, 11)   # #f59e0b
    TEXT_WHITE = RGBColor(240, 246, 252)    # #f0f6fc
    TEXT_MUTED = RGBColor(139, 148, 158)    # #8b949e
    TEXT_BODY = RGBColor(201, 209, 217)     # #c9d1d9

    base_dir = os.path.dirname(os.path.abspath(__file__))
    img_ingest = os.path.join(base_dir, "screenshot_ingest.png")
    img_search = os.path.join(base_dir, "screenshot_search.png")
    img_graph = os.path.join(base_dir, "screenshot_graph.png")

    def add_bg(slide):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = BG_DARK
        bg.line.fill.background()
        return bg

    def add_card(slide, left, top, width, height, bg_color=CARD_BG, border_color=CARD_BORDER):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        card.line.color.rgb = border_color
        card.line.width = Pt(1.5)
        return card

    def add_header(slide, title_text, category_text="LOCAL RAG STUDIO"):
        cat_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(10), Inches(0.35))
        tf_cat = cat_box.text_frame
        p_cat = tf_cat.paragraphs[0]
        p_cat.text = category_text.upper()
        p_cat.font.name = "Segoe UI"
        p_cat.font.size = Pt(10)
        p_cat.font.bold = True
        p_cat.font.color.rgb = ACCENT_BLUE

        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(11.5), Inches(0.75))
        tf_title = title_box.text_frame
        p_title = tf_title.paragraphs[0]
        p_title.text = title_text
        p_title.font.name = "Segoe UI"
        p_title.font.size = Pt(22)
        p_title.font.bold = True
        p_title.font.color.rgb = TEXT_WHITE

    # -------------------------------------------------------------
    # SLIDE 1: Title Slide (Cover)
    # -------------------------------------------------------------
    s1 = prs.slides.add_slide(blank_layout)
    add_bg(s1)
    add_card(s1, Inches(0.8), Inches(0.9), Inches(11.733), Inches(5.7), bg_color=CARD_BG, border_color=CARD_BORDER)

    tag_box = s1.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(8), Inches(0.35))
    tf_tag = tag_box.text_frame
    p_tag = tf_tag.paragraphs[0]
    p_tag.text = "PROGETTO ENTERPRISE • 100% LOCALE & PRIVACY-FIRST"
    p_tag.font.name = "Segoe UI"
    p_tag.font.size = Pt(11)
    p_tag.font.bold = True
    p_tag.font.color.rgb = ACCENT_PURPLE

    title_box = s1.shapes.add_textbox(Inches(1.2), Inches(1.65), Inches(10.8), Inches(1.4))
    tf_title = title_box.text_frame
    tf_title.word_wrap = True
    p1 = tf_title.paragraphs[0]
    p1.text = "Local Multimodal RAG & Knowledge Graph Studio"
    p1.font.name = "Segoe UI"
    p1.font.size = Pt(32)
    p1.font.bold = True
    p1.font.color.rgb = TEXT_WHITE

    sub_box = s1.shapes.add_textbox(Inches(1.2), Inches(3.1), Inches(10.8), Inches(0.7))
    tf_sub = sub_box.text_frame
    tf_sub.word_wrap = True
    p_sub = tf_sub.paragraphs[0]
    p_sub.text = "Ingestion documentale ricorsiva, embedding su GPU NVIDIA (EmbeddingGemma-2) e navigazione a grafo Obsidian."
    p_sub.font.name = "Segoe UI"
    p_sub.font.size = Pt(14)
    p_sub.font.color.rgb = TEXT_MUTED

    pill_data = [
        ("NVIDIA GPU CUDA", "EmbeddingGemma-2 (768d)\nZero latenza, 100% locale", ACCENT_BLUE),
        ("Qdrant Vector DB", "Database vettoriale in Docker\nHNSW indexing istantaneo", ACCENT_EMERALD),
        ("Grafo Obsidian", "Visualizzazione interattiva\nCorrelazioni semantiche live", ACCENT_PURPLE)
    ]
    for idx, (head, desc, color) in enumerate(pill_data):
        x = Inches(1.2 + idx * 3.7)
        y = Inches(4.3)
        w = Inches(3.5)
        h = Inches(1.8)
        add_card(s1, x, y, w, h, bg_color=RGBColor(16, 21, 28), border_color=color)

        tb = s1.shapes.add_textbox(x + Inches(0.2), y + Inches(0.2), w - Inches(0.4), h - Inches(0.4))
        tf = tb.text_frame
        tf.word_wrap = True
        p_h = tf.paragraphs[0]
        p_h.text = head
        p_h.font.name = "Segoe UI"
        p_h.font.size = Pt(13)
        p_h.font.bold = True
        p_h.font.color.rgb = color

        p_d = tf.add_paragraph()
        p_d.space_before = Pt(6)
        p_d.text = desc
        p_d.font.name = "Segoe UI"
        p_d.font.size = Pt(11)
        p_d.font.color.rgb = TEXT_BODY

    # -------------------------------------------------------------
    # SLIDE 2: Vision & GUI Ingestion
    # -------------------------------------------------------------
    s2 = prs.slides.add_slide(blank_layout)
    add_bg(s2)
    add_header(s2, "Visione di Progetto & Interfaccia di Ingestion Ricorsiva", "OBIETTIVI & INGESTION")

    # Left Card: Punti chiave (Concisi)
    add_card(s2, Inches(0.8), Inches(1.5), Inches(5.2), Inches(5.4))
    tb_c1 = s2.shapes.add_textbox(Inches(1.0), Inches(1.7), Inches(4.8), Inches(5.0))
    tf_c1 = tb_c1.text_frame
    tf_c1.word_wrap = True

    p = tf_c1.paragraphs[0]
    p.text = "🎯 Dati Non Strutturati Sotto Controllo"
    p.font.name = "Segoe UI"
    p.font.size = Pt(15)
    p.font.bold = True
    p.font.color.rgb = ACCENT_BLUE

    points_s2 = [
        ("100% On-Premise", "Zero dati inviati al cloud, piena aderenza GDPR e massima sovranità."),
        ("Ingestion Ricorsiva", "Scansione automatica di cartelle padre e tutte le sottocartelle preservando la gerarchia."),
        ("Parsing Ibrido Multi-Formato", "Docling + Pandas per PDF, DOCX/DOC e fogli Excel (.xlsx e .xls) complessi."),
        ("Coda & Log Real-Time", "Monitoraggio live dell'avanzamento, chunking e vettorializzazione.")
    ]
    for b_title, b_desc in points_s2:
        p_bt = tf_c1.add_paragraph()
        p_bt.space_before = Pt(12)
        p_bt.text = f"✓ {b_title}: "
        p_bt.font.name = "Segoe UI"
        p_bt.font.size = Pt(11)
        p_bt.font.bold = True
        p_bt.font.color.rgb = ACCENT_EMERALD
        run = p_bt.add_run()
        run.text = b_desc
        run.font.bold = False
        run.font.color.rgb = TEXT_BODY

    # Right Card: GUI Screenshot Ingestion
    add_card(s2, Inches(6.3), Inches(1.5), Inches(6.233), Inches(5.4))
    if os.path.exists(img_ingest):
        s2.shapes.add_picture(img_ingest, Inches(6.45), Inches(1.65), Inches(5.933), Inches(4.5))
        # Caption
        cap_box = s2.shapes.add_textbox(Inches(6.45), Inches(6.25), Inches(5.933), Inches(0.5))
        p_cap = cap_box.text_frame.paragraphs[0]
        p_cap.text = "📸 GUI Ingestion: Drag & Drop, Scansione Ricorsiva e Coda File Real-Time"
        p_cap.font.name = "Segoe UI"
        p_cap.font.size = Pt(9.5)
        p_cap.font.color.rgb = TEXT_MUTED

    # -------------------------------------------------------------
    # SLIDE 3: Architettura di Sistema Multi-Layer
    # -------------------------------------------------------------
    s3 = prs.slides.add_slide(blank_layout)
    add_bg(s3)
    add_header(s3, "Architettura Software & Stack Tecnologico Multi-Layer", "ARCHITETTURA TECNICA")

    layers = [
        {
            "title": "1. FRONTEND EXPERIENCE",
            "tech": "React 19 • Vite • Tailwind v4",
            "desc": "Interfaccia dark reattiva con Explorer in-app, Ricerca RAG e grafo Obsidian 2D/3D.",
            "color": ACCENT_BLUE
        },
        {
            "title": "2. BACKEND API GATEWAY",
            "tech": "Node.js • Express 5 • TSX",
            "desc": "Upload multipart, scansione filesystem ad albero, calcolo adiacenze semantiche.",
            "color": ACCENT_PURPLE
        },
        {
            "title": "3. AI & PARSING ENGINE",
            "tech": "Python 3.12 • PyTorch CUDA",
            "desc": "Microservizio su GPU RTX 4050 con EmbeddingGemma-2 (768d) e IBM Docling.",
            "color": ACCENT_EMERALD
        },
        {
            "title": "4. VECTOR ENGINE",
            "tech": "Qdrant Vector DB (Docker)",
            "desc": "Indicizzazione HNSW a bassa latenza, ricerca per similarità coseno e persistenza.",
            "color": ACCENT_AMBER
        }
    ]

    for idx, lyr in enumerate(layers):
        x = Inches(0.8 + idx * 2.98)
        y = Inches(1.5)
        w = Inches(2.82)
        h = Inches(5.4)
        add_card(s3, x, y, w, h, bg_color=CARD_BG, border_color=CARD_BORDER)

        top_bar = s3.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, Inches(0.12))
        top_bar.fill.solid()
        top_bar.fill.fore_color.rgb = lyr["color"]
        top_bar.line.fill.background()

        tb = s3.shapes.add_textbox(x + Inches(0.2), y + Inches(0.25), w - Inches(0.4), h - Inches(0.4))
        tf = tb.text_frame
        tf.word_wrap = True

        p_t = tf.paragraphs[0]
        p_t.text = lyr["title"]
        p_t.font.name = "Segoe UI"
        p_t.font.size = Pt(12)
        p_t.font.bold = True
        p_t.font.color.rgb = lyr["color"]

        p_tec = tf.add_paragraph()
        p_tec.space_before = Pt(8)
        p_tec.text = lyr["tech"]
        p_tec.font.name = "Segoe UI"
        p_tec.font.size = Pt(10)
        p_tec.font.bold = True
        p_tec.font.color.rgb = TEXT_WHITE

        p_d = tf.add_paragraph()
        p_d.space_before = Pt(16)
        p_d.text = lyr["desc"]
        p_d.font.name = "Segoe UI"
        p_d.font.size = Pt(11)
        p_d.font.color.rgb = TEXT_BODY

    # -------------------------------------------------------------
    # SLIDE 4: GUI Ricerca Semantica & Grafo Obsidian (2 Immagini)
    # -------------------------------------------------------------
    s4 = prs.slides.add_slide(blank_layout)
    add_bg(s4)
    add_header(s4, "Interfaccia Utente: Ricerca Semantica RAG & Grafo di Conoscenza", "GUI & USER EXPERIENCE")

    # Left: Ricerca Semantica GUI
    add_card(s4, Inches(0.8), Inches(1.5), Inches(5.7), Inches(5.4))
    tb_s4_l = s4.shapes.add_textbox(Inches(1.0), Inches(1.65), Inches(5.3), Inches(0.6))
    p_l = tb_s4_l.text_frame.paragraphs[0]
    p_l.text = "🔍 1. Ricerca Semantica RAG Contestualizzata"
    p_l.font.name = "Segoe UI"
    p_l.font.size = Pt(13)
    p_l.font.bold = True
    p_l.font.color.rgb = ACCENT_EMERALD

    if os.path.exists(img_search):
        s4.shapes.add_picture(img_search, Inches(1.0), Inches(2.25), Inches(5.3), Inches(3.6))

    tb_s4_l_desc = s4.shapes.add_textbox(Inches(1.0), Inches(6.0), Inches(5.3), Inches(0.7))
    p_ld = tb_s4_l_desc.text_frame.paragraphs[0]
    p_ld.text = "• Slider soglia minima a passo unitario (1%)\n• Scheda perimetro collezione posizionata sotto la barra di ricerca"
    p_ld.font.name = "Segoe UI"
    p_ld.font.size = Pt(9.5)
    p_ld.font.color.rgb = TEXT_BODY

    # Right: Grafo Obsidian GUI
    add_card(s4, Inches(6.833), Inches(1.5), Inches(5.7), Inches(5.4))
    tb_s4_r = s4.shapes.add_textbox(Inches(7.033), Inches(1.65), Inches(5.3), Inches(0.6))
    p_r = tb_s4_r.text_frame.paragraphs[0]
    p_r.text = "🕸️ 2. Obsidian Knowledge Graph Studio"
    p_r.font.name = "Segoe UI"
    p_r.font.size = Pt(13)
    p_r.font.bold = True
    p_r.font.color.rgb = ACCENT_PURPLE

    if os.path.exists(img_graph):
        s4.shapes.add_picture(img_graph, Inches(7.033), Inches(2.25), Inches(5.3), Inches(3.6))

    tb_s4_r_desc = s4.shapes.add_textbox(Inches(7.033), Inches(6.0), Inches(5.3), Inches(0.7))
    p_rd = tb_s4_r_desc.text_frame.paragraphs[0]
    p_rd.text = "• Controlli navigazione in alto (Zoom In/Out, Fit-to-screen)\n• Connessioni pesate da similarità coseno tra documenti e chunk"
    p_rd.font.name = "Segoe UI"
    p_rd.font.size = Pt(9.5)
    p_rd.font.color.rgb = TEXT_BODY

    # -------------------------------------------------------------
    # SLIDE 5: Risultati, Metriche & Roadmap
    # -------------------------------------------------------------
    s5 = prs.slides.add_slide(blank_layout)
    add_bg(s5)
    add_header(s5, "Metriche di Performance Verificate & Roadmap Evolutiva", "METRICHE & ROADMAP")

    # Left: Key Metrics
    add_card(s5, Inches(0.8), Inches(1.5), Inches(5.7), Inches(5.4))
    tb_m = s5.shapes.add_textbox(Inches(1.1), Inches(1.7), Inches(5.1), Inches(5.0))
    tf_m = tb_m.text_frame
    tf_m.word_wrap = True

    pm = tf_m.paragraphs[0]
    pm.text = "📊 Indicatori Chiave e Risultati del Testbed"
    pm.font.name = "Segoe UI"
    pm.font.size = Pt(15)
    pm.font.bold = True
    pm.font.color.rgb = ACCENT_BLUE

    metrics = [
        ("Velocità Embedding GPU", "Pochi ms/chunk su GPU RTX 4050 con PyTorch CUDA"),
        ("Tasso di Successo Ingestion", "100% formati supportati estratti (322+ chunk verificati)"),
        ("Latenza Ricerca Vettoriale", "< 15 ms per query top-8 su indice HNSW di Qdrant"),
        ("Privacy & Sovranità Dati", "0 byte inviati a terze parti: isolamento totale garantito")
    ]
    for m_label, m_val in metrics:
        p_m = tf_m.add_paragraph()
        p_m.space_before = Pt(12)
        p_m.text = f"🔹 {m_label}\n   "
        p_m.font.name = "Segoe UI"
        p_m.font.size = Pt(11)
        p_m.font.bold = True
        p_m.font.color.rgb = TEXT_WHITE
        run = p_m.add_run()
        run.text = m_val
        run.font.bold = False
        run.font.color.rgb = TEXT_BODY

    # Right: Roadmap
    add_card(s5, Inches(6.833), Inches(1.5), Inches(5.7), Inches(5.4))
    tb_r = s5.shapes.add_textbox(Inches(7.133), Inches(1.7), Inches(5.1), Inches(5.0))
    tf_r = tb_r.text_frame
    tf_r.word_wrap = True

    pr = tf_r.paragraphs[0]
    pr.text = "🚀 Prossime Evolutive nella Roadmap"
    pr.font.name = "Segoe UI"
    pr.font.size = Pt(15)
    pr.font.bold = True
    pr.font.color.rgb = ACCENT_PURPLE

    roadmap = [
        ("Generazione RAG con LLM Locale", "Integrazione di Gemma / Llama via Ollama per risposte sintetiche con citazione automatica delle fonti."),
        ("Grafo 3D (Three.js / WebGL)", "Navigazione tridimensionale ad alte prestazioni per basi documentali oltre i 10.000 nodi."),
        ("Filtri Ibridi Semantico-Metadato", "Ricerca combinata per periodo temporale, tipologia documento e autore."),
        ("Watcher Cartelle di Rete", "Sincronizzazione e auto-indicizzazione continua su cartelle condivise.")
    ]
    for r_title, r_desc in roadmap:
        p_r = tf_r.add_paragraph()
        p_r.space_before = Pt(12)
        p_r.text = f"⚡ {r_title}: "
        p_r.font.name = "Segoe UI"
        p_r.font.size = Pt(11)
        p_r.font.bold = True
        p_r.font.color.rgb = ACCENT_PURPLE
        run = p_r.add_run()
        run.text = r_desc
        run.font.bold = False
        run.font.color.rgb = TEXT_BODY

    prs.save(output_path)
    print(f"Presentation with GUI images updated at: {output_path}")

if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "Presentazione_RAG_Studio.pptx"
    create_deck(out_file)
