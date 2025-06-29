const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Per la conversione Markdown -> DOCX
const { marked } = require('marked');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const app = express();
const PORT = 3100;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve file statici
app.use(express.static(path.join(__dirname, 'public')));


// Configurazione multer per upload file
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/markdown' || 
        file.mimetype === 'text/plain' || 
        file.originalname.endsWith('.md') || 
        file.originalname.endsWith('.markdown')) {
      cb(null, true);
    } else {
      cb(new Error('Solo file Markdown (.md) sono supportati'), false);
    }
  }
});

// Inizializza database SQLite
const dbPath = path.join(__dirname, 'amazon_books.db');
const db = new sqlite3.Database(dbPath);

// Crea tabella se non esiste
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS books (
    asin TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    image_src TEXT,
    large_image TEXT,
    is_sponsored TEXT,
    type TEXT,
    author TEXT,
    price TEXT,
    price_strike REAL,
    is_best_seller TEXT,
    ratings INTEGER,
    rating_avg TEXT,
    publisher TEXT,
    bsr INTEGER,
    monthly_sales REAL,
    pages_num INTEGER,
    dimensions TEXT,
    print_cost REAL,
    description TEXT,
    is_color TEXT,
    royalties REAL,
    monthly_gain REAL,
    monthly_net_gain REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Route per servire la pagina principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Endpoints

// POST /api/books - Salva uno o più libri
app.post('/api/books', (req, res) => {
  const books = Array.isArray(req.body) ? req.body : [req.body];
  
  const stmt = db.prepare(`INSERT OR REPLACE INTO books (
    asin, title, url, image_src, large_image, is_sponsored, type, author, 
    price, price_strike, is_best_seller, ratings, rating_avg, publisher, 
    bsr, monthly_sales, pages_num, dimensions, print_cost, description, 
    is_color, royalties, monthly_gain, monthly_net_gain, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);

  let savedCount = 0;
  let errors = [];

  books.forEach((book, index) => {
    try {
      stmt.run([
        book.asin,
        book.title,
        book.url,
        book.imageSrc,
        book.largeImage,
        book.isSponsored,
        book.type,
        book.author,
        book.price,
        book.priceStrike || 0,
        book.isBestSeller,
        book.ratings || 0,
        book.ratingAvg,
        book.publisher,
        book.bsr || 0,
        book.monthlySales || 0,
        book.pagesnum || 0,
        book.dimensions,
        book.printCost || 0,
        book.description,
        book.isColor,
        book.royalties || 0,
        book.monthlyGain || 0,
        book.monthlyNETGain || 0
      ]);
      savedCount++;
    } catch (error) {
      errors.push({ index, asin: book.asin, error: error.message });
    }
  });

  stmt.finalize();

  res.json({
    success: true,
    message: `${savedCount} libri salvati`,
    errors: errors.length > 0 ? errors : undefined
  });
});



// Route per servire la pagina di conversione Markdown
app.get('/markdown-converter', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'markdown-converter.html'));
});

// Funzione per convertire Markdown in DOCX
function markdownToDocx(markdownText) {
  // Configura marked per parsing
  const tokens = marked.lexer(markdownText);
  const paragraphs = [];

  tokens.forEach(token => {
    switch (token.type) {
      case 'heading':
        paragraphs.push(
          new Paragraph({
            text: token.text,
            heading: token.depth === 1 ? HeadingLevel.HEADING_1 :
                    token.depth === 2 ? HeadingLevel.HEADING_2 :
                    token.depth === 3 ? HeadingLevel.HEADING_3 :
                    token.depth === 4 ? HeadingLevel.HEADING_4 :
                    token.depth === 5 ? HeadingLevel.HEADING_5 : HeadingLevel.HEADING_6,
          })
        );
        break;

      case 'paragraph':
        const children = [];
        const inlineTokens = marked.lexer(token.text, { gfm: true });
        
        if (inlineTokens.length === 1 && inlineTokens[0].type === 'paragraph') {
          // Parse inline formatting
          parseInlineFormatting(inlineTokens[0].text, children);
        } else {
          children.push(new TextRun(token.text));
        }
        
        paragraphs.push(new Paragraph({ children }));
        break;

      case 'list':
        token.items.forEach((item, index) => {
          const listText = item.text.replace(/<[^>]*>/g, ''); // Rimuovi tag HTML
          paragraphs.push(
            new Paragraph({
              text: `${token.ordered ? `${index + 1}. ` : '• '}${listText}`,
              indent: { left: 360 }, // Indentazione lista
            })
          );
        });
        break;

      case 'blockquote':
        paragraphs.push(
          new Paragraph({
            text: token.text.replace(/<[^>]*>/g, ''),
            indent: { left: 720 }, // Doppia indentazione per quote
            italics: true,
          })
        );
        break;

      case 'code':
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: token.text,
                font: 'Courier New',
                size: 20,
              })
            ],
          })
        );
        break;

      case 'hr':
        paragraphs.push(
          new Paragraph({
            text: '─'.repeat(50),
            alignment: AlignmentType.CENTER,
          })
        );
        break;

      default:
        if (token.text) {
          paragraphs.push(new Paragraph({ text: token.text }));
        }
        break;
    }
  });

  return new Document({
    sections: [{
      properties: {},
      children: paragraphs,
    }],
  });
}

// Funzione helper per parsing formattazione inline
function parseInlineFormatting(text, children) {
  // Pulisce il testo rimuovendo spazi extra ma preservando le interruzioni di riga significative
  const cleanText = text.replace(/[ \t]+/g, ' ').trim();
  
  // Trova tutti i pattern di formattazione
  const patterns = [
    { regex: /\*\*((?:[^*]|\*(?!\*))*?)\*\*/g, type: 'bold' }, // Pattern più preciso per bold
    { regex: /(?<!\*)\*([^*\n]+?)\*(?!\*)/g, type: 'italic' }, 
    { regex: /`([\s\S]*?)`/g, type: 'code' } 
  ];

  const matches = [];
  
  // Raccoglie tutti i match con posizioni
  patterns.forEach(pattern => {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    
    while ((match = regex.exec(cleanText)) !== null) {
      // Pulisce il testo catturato rimuovendo spazi extra
      const capturedText = match[1].replace(/\s+/g, ' ').trim();
      
      matches.push({
        start: match.index,
        end: regex.lastIndex,
        text: capturedText,
        type: pattern.type,
        fullMatch: match[0]
      });
    }
  });

  // Ordina per posizione
  matches.sort((a, b) => a.start - b.start);

  // Rimuove sovrapposizioni (priorità: bold > italic > code)
  const priority = { bold: 3, italic: 2, code: 1 };
  const validMatches = [];
  
  matches.forEach(match => {
    const overlapping = validMatches.find(existing => 
      (match.start < existing.end && match.end > existing.start)
    );
    
    if (!overlapping || priority[match.type] > priority[overlapping.type]) {
      if (overlapping) {
        const index = validMatches.indexOf(overlapping);
        validMatches.splice(index, 1);
      }
      validMatches.push(match);
    }
  });

  // Riordina per posizione
  validMatches.sort((a, b) => a.start - b.start);

  // Costruisce i TextRun
  let lastIndex = 0;
  
  validMatches.forEach(match => {
    // Aggiungi testo normale prima del match
    if (match.start > lastIndex) {
      const normalText = cleanText.slice(lastIndex, match.start);
      if (normalText) {
        children.push(new TextRun(normalText));
      }
    }
    
    // Aggiungi il testo formattato
    const runOptions = { text: match.text };
    
    switch (match.type) {
      case 'bold':
        runOptions.bold = true;
        break;
      case 'italic':
        runOptions.italics = true;
        break;
      case 'code':
        runOptions.font = 'Courier New';
        runOptions.size = 20;
        break;
    }
    
    children.push(new TextRun(runOptions));
    lastIndex = match.end;
  });
  
  // Aggiungi il resto del testo
  if (lastIndex < cleanText.length) {
    const remainingText = cleanText.slice(lastIndex);
    if (remainingText) {
      children.push(new TextRun(remainingText));
    }
  }
  
  // Se non ci sono match, aggiungi tutto il testo
  if (children.length === 0) {
    children.push(new TextRun(cleanText));
  }
}

// POST /api/convert-markdown - Converte file Markdown in DOCX
app.post('/api/convert-markdown', upload.single('markdownFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    // Leggi il contenuto del file
    const markdownContent = fs.readFileSync(req.file.path, 'utf8');
    
    // Converti in documento DOCX
    const doc = markdownToDocx(markdownContent);
    
    // Genera il buffer DOCX
    const buffer = await Packer.toBuffer(doc);
    
    // Nome del file output
    const outputFileName = req.file.originalname.replace(/\.(md|markdown)$/i, '.docx');
    
    // Pulisci il file temporaneo
    fs.unlinkSync(req.file.path);
    
    // Invia il file DOCX
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Errore conversione Markdown:', error);
    
    // Pulisci il file temporaneo in caso di errore
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Errore durante la conversione del file' });
  }
});



// GET /api/books - Recupera tutti i libri con filtri opzionali
app.get('/api/books', (req, res) => {
  const { 
    publisher, 
    minRoyalties, 
    maxBsr, 
    minBsr,
    minNetGain,
    maxNetGain,
    titleKeyword,
    type, 
    limit = 100, 
    offset = 0,
    sortBy = 'monthly_net_gain',
    sortOrder = 'DESC'
  } = req.query;

  let query = 'SELECT * FROM books WHERE 1=1';
  let params = [];

  if (publisher) {
    query += ' AND publisher LIKE ?';
    params.push(`%${publisher}%`);
  }

  if (minRoyalties) {
    query += ' AND royalties >= ?';
    params.push(parseFloat(minRoyalties));
  }

  if (maxBsr) {
    query += ' AND bsr <= ?';
    params.push(parseInt(maxBsr));
  }

  if (minBsr) {
    query += ' AND bsr >= ?';
    params.push(parseInt(minBsr));
  }

  if (minNetGain) {
    query += ' AND monthly_net_gain >= ?';
    params.push(parseFloat(minNetGain));
  }

  if (maxNetGain) {
    query += ' AND monthly_net_gain <= ?';
    params.push(parseFloat(maxNetGain));
  }

  if (titleKeyword) {
    query += ' AND title LIKE ?';
    params.push(`%${titleKeyword}%`);
  }

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  // Validazione sortBy per sicurezza
  const allowedSortFields = [
    'asin', 'title', 'bsr', 'monthly_sales', 'royalties', 
    'monthly_gain', 'monthly_net_gain', 'created_at', 'updated_at', 'ratings'
  ];
  
  if (allowedSortFields.includes(sortBy)) {
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortBy} ${order}`;
  }

  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Query per il count totale (senza limit/offset)
    let countQuery = query.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '');
    let countParams = params.slice(0, -2); // Rimuovi limit e offset

    db.get(`SELECT COUNT(*) as total FROM (${countQuery})`, countParams, (err, countResult) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      res.json({
        books: rows,
        count: rows.length,
        total: countResult.total,
        hasMore: (parseInt(offset) + parseInt(limit)) < countResult.total
      });
    });
  });
});

// GET /api/books/:asin - Recupera un libro specifico
app.get('/api/books/:asin', (req, res) => {
  const asin = req.params.asin;
  
  db.get('SELECT * FROM books WHERE asin = ?', [asin], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Libro non trovato' });
      return;
    }
    res.json(row);
  });
});

// DELETE /api/books/:asin - Elimina un libro
app.delete('/api/books/:asin', (req, res) => {
  const asin = req.params.asin;
  
  db.run('DELETE FROM books WHERE asin = ?', [asin], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Libro non trovato' });
      return;
    }
    res.json({ message: 'Libro eliminato con successo' });
  });
});

// GET /api/stats - Statistiche generali
app.get('/api/stats', (req, res) => {
  const queries = {
    total: 'SELECT COUNT(*) as count FROM books',
    byPublisher: 'SELECT publisher, COUNT(*) as count FROM books GROUP BY publisher ORDER BY count DESC LIMIT 10',
    avgRoyalties: 'SELECT AVG(royalties) as avg_royalties FROM books WHERE royalties > 0',
    topEarners: 'SELECT title, monthly_net_gain FROM books ORDER BY monthly_net_gain DESC LIMIT 10'
  };

  const stats = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.all(query, (err, rows) => {
      if (!err) {
        stats[key] = key === 'total' || key === 'avgRoyalties' ? rows[0] : rows;
      }
      completed++;
      
      if (completed === totalQueries) {
        res.json(stats);
      }
    });
  });
});

// Gestione errori globale
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Errore interno del server' });
});

// Avvio server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
  console.log(`📊 Database: ${dbPath}`);
  console.log(`🌐 Interfaccia web: http://localhost:${PORT}`);
  console.log('\n📋 Endpoints disponibili:');
  console.log('  POST   /api/books       - Salva libri');
  console.log('  GET    /api/books       - Lista libri (con filtri)');
  console.log('  GET    /api/books/:asin - Dettaglio libro');
  console.log('  DELETE /api/books/:asin - Elimina libro');
  console.log('  GET    /api/stats       - Statistiche');
});

// Gestione chiusura graceful
process.on('SIGINT', () => {
  console.log('\n🔄 Chiusura server...');
  db.close((err) => {
    if (err) {
      console.error('Errore chiusura database:', err.message);
    }
    console.log('✅ Database chiuso');
    process.exit(0);
  });
});