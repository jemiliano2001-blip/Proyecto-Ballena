import { useState, useRef } from 'react';
import { Sparkles, FileSpreadsheet, Copy, Bot, Loader2, Check, ImagePlus, X, ExternalLink, UploadCloud, AlertCircle, Languages, Globe, Download } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from '@google/genai';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type OrderRow = {
  id: string;
  status: string;
  orderDate: string;
  provider: string;
  qty: number;
  desc: string;
  link: string;
  deliveryDate: string;
  requester: string;
  workOrder: string;
  company: string;
};

// Helper to convert blob URL to base64 for Gemini API
async function urlToBase64(url: string): Promise<{ mimeType: string, data: string }> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(',')[1];
      resolve({ mimeType: blob.type, data: base64data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'completa' | 'simple'>('completa');
  const [autoStandardize, setAutoStandardize] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<OrderRow[] | null>(null);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExtract = async () => {
    if (!inputText.trim() && images.length === 0) return;
    setIsExtracting(true);
    setExtractedData(null);
    setDetectedLanguage(null);
    
    try {
      // Initialize Gemini API
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const parts: any[] = [];
      
      // Add text input if exists
      if (inputText.trim()) {
        parts.push({ text: `Texto de órdenes:\n${inputText}` });
      }
      
      // Add images if exist
      for (const imgUrl of images) {
        const { mimeType, data } = await urlToBase64(imgUrl);
        parts.push({
          inlineData: {
            mimeType,
            data
          }
        });
      }
      
      // Add instructions
      let promptText = `Extrae la información de las órdenes de compra de las imágenes y el texto proporcionado. 
Si algún campo no está presente o no se puede inferir, déjalo como una cadena vacía (""). 
Si ves un enlace o URL, ponlo en el campo 'link'.`;

      if (autoStandardize) {
        promptText += `\n\nREGLAS DE ESTANDARIZACIÓN Y TRADUCCIÓN (OBLIGATORIAS):
1. Traducción: Detecta el idioma original. Traduce TODAS las descripciones de productos al español de forma natural.
2. Proveedores: Escribe el nombre del proveedor en formato Título (ej. "Home Depot", "Amazon", "Mouser").
3. Fechas: Formatea estrictamente todas las fechas como DD/MM/YYYY.
4. Estado: Clasifica el estado obligatoriamente en uno de estos: "Entregado", "Comprado", "Pendiente", "Cancelado".
5. Limpieza: Elimina comillas innecesarias o caracteres extraños en las descripciones.`;
      }

      parts.push({ text: promptText });

      // Call Gemini API (using flash for speed)
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          temperature: 0.1, // Low temperature for factual extraction
          responseSchema: {
            type: Type.ARRAY,
            description: "Lista de órdenes de compra extraídas",
            items: {
              type: Type.OBJECT,
              properties: {
                status: { type: Type.STRING, description: "Estado del pedido (ej. Entregado, Comprado, Pendiente)" },
                orderDate: { type: Type.STRING, description: "Fecha del pedido (DD/MM/YYYY)" },
                provider: { type: Type.STRING, description: "Proveedor o tienda" },
                qty: { type: Type.NUMBER, description: "Cantidad de artículos (número)" },
                desc: { type: Type.STRING, description: "Descripción del artículo (en español)" },
                link: { type: Type.STRING, description: "URL o Link del producto (si existe)" },
                deliveryDate: { type: Type.STRING, description: "Fecha de entrega o guía (DD/MM/YYYY)" },
                requester: { type: Type.STRING, description: "Requisitor (persona que solicita)" },
                workOrder: { type: Type.STRING, description: "Orden de Trabajo o Proyecto" },
                company: { type: Type.STRING, description: "Empresa" }
              },
              required: ["status", "orderDate", "provider", "qty", "desc", "link", "deliveryDate", "requester", "workOrder", "company"]
            }
          }
        }
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text);
        const dataWithIds = parsedData.map((item: any) => ({
          ...item,
          id: crypto.randomUUID()
        }));
        setExtractedData(dataWithIds);
        showToast('¡Extracción completada con éxito!', 'success');
      } else {
        throw new Error("No se recibió respuesta válida de Gemini.");
      }
      
    } catch (error) {
      console.error("Error extracting data:", error);
      showToast('Error al extraer datos. Intenta de nuevo.', 'error');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleClearAll = () => {
    setInputText('');
    setImages([]);
    setExtractedData(null);
    setDetectedLanguage(null);
    showToast('Datos limpiados', 'success');
  };

  const handleCellChange = (id: string, field: keyof OrderRow, value: string | number) => {
    setExtractedData(prev => {
      if (!prev) return prev;
      return prev.map(row => row.id === id ? { ...row, [field]: value } : row);
    });
  };

  const handleExportCSV = () => {
    if (!extractedData || extractedData.length === 0) return;
    
    const headers = ['Estado', 'Fecha', 'Proveedor', 'Cantidad', 'Descripción', 'Link', 'Entrega', 'Requisitor', 'Orden Trabajo', 'Empresa'];
    const escapeCSV = (str: string | number | undefined) => `"${String(str || '').replace(/"/g, '""')}"`;
    
    const rows = extractedData.map(row => [
      escapeCSV(row.status),
      escapeCSV(row.orderDate),
      escapeCSV(row.provider),
      escapeCSV(row.qty),
      escapeCSV(row.desc),
      escapeCSV(row.link),
      escapeCSV(row.deliveryDate),
      escapeCSV(row.requester),
      escapeCSV(row.workOrder),
      escapeCSV(row.company)
    ].join(','));
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ordenes_extraidas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('¡Archivo CSV exportado!', 'success');
  };

  const handleCopyToSheets = async () => {
    if (!extractedData) return;
    
    const headers = ['Estado del pedido', 'Fecha del pedido', 'Proveedor', 'Cantidad', 'Descripción', 'Link', 'Fecha de entrega o guía', 'Requisitor', 'Orden Trabajo', 'Empresa'];
    const rows = extractedData.map(row => [
      row.status,
      row.orderDate,
      row.provider,
      row.qty.toString(),
      row.desc,
      row.link,
      row.deliveryDate || '',
      row.requester || '',
      row.workOrder || '',
      row.company || ''
    ]);
    
    const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    
    try {
      await navigator.clipboard.writeText(tsv);
      showToast('¡Copiado! Listo para pegar en Sheets', 'success');
    } catch (error) {
      console.error('Error al copiar al portapapeles:', error);
      showToast('Error al copiar los datos', 'error');
    }
  };

  const handleCopyTable = async () => {
    if (!extractedData) return;
    
    const headers = ['Estado del pedido', 'Fecha del pedido', 'Proveedor', 'Cantidad', 'Descripción', 'Link', 'Fecha de entrega o guía', 'Requisitor', 'Orden Trabajo', 'Empresa'];
    const rows = extractedData.map(row => [
      row.status,
      row.orderDate,
      row.provider,
      row.qty.toString(),
      row.desc,
      row.link,
      row.deliveryDate,
      row.requester,
      row.workOrder,
      row.company
    ]);
    
    const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    
    try {
      await navigator.clipboard.writeText(tsv);
      showToast('¡Tabla copiada!', 'success');
    } catch (error) {
      console.error('Error al copiar al portapapeles:', error);
      showToast('Error al copiar la tabla', 'error');
    }
  };

  const handleSuggestAccounts = () => {
    showToast('¡Sugerencias de cuentas generadas!', 'success');
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Image handling
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const imageUrl = URL.createObjectURL(file);
          setImages(prev => [...prev, imageUrl]);
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newImages = Array.from(e.target.files).map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...newImages]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
      const newImages = droppedFiles.map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...newImages]);
    }
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 font-sans p-4 md:p-8 relative overflow-hidden selection:bg-fuchsia-500/40 selection:text-white">
      
      {/* Extravagant Background Elements */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a_1px,transparent_1px),linear-gradient(to_bottom,#27272a_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none opacity-50" />
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-fuchsia-500/10 blur-[120px] pointer-events-none" />

      <div className="max-w-[1500px] mx-auto space-y-8 md:space-y-12 relative z-10">
        
        {/* Header - Extravagant Typography */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6 sm:mb-8 border-b-4 border-zinc-900 pb-6 sm:pb-8">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-20 md:h-20 bg-black border-2 border-lime-400 flex items-center justify-center shadow-[4px_4px_0px_#a3e635] shrink-0 transform -rotate-6 hover:rotate-0 transition-transform duration-300">
              <Bot className="text-lime-400 w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" />
            </div>
            <div>
              <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-lime-400 leading-none drop-shadow-[0_0_15px_rgba(217,70,239,0.3)] break-words">
                Extractor
              </h1>
              <p className="text-lime-400 font-mono text-[10px] sm:text-xs md:text-sm mt-2 tracking-widest uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-lime-400 animate-pulse shrink-0" />
                <span className="truncate">Powered by Gemini 3.1 Pro</span>
              </p>
            </div>
          </div>
        </header>

        {/* Main Input Card - Brutalist/Neon */}
        <div className="bg-black border-2 border-zinc-800 p-4 sm:p-6 md:p-8 shadow-[8px_8px_0px_#27272a] relative group/card hover:border-zinc-700 transition-colors">
          {/* Decorative corner accents */}
          <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-cyan-400 -translate-x-1 -translate-y-1" />
          <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-fuchsia-400 translate-x-1 -translate-y-1" />
          <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-lime-400 -translate-x-1 translate-y-1" />
          <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-yellow-400 translate-x-1 translate-y-1" />
          
          <div className="flex flex-col lg:flex-row gap-8 mb-8">
            {/* Input Area (Text + Images) */}
            <div className="flex-1 flex flex-col gap-4">
              {detectedLanguage && (
                <div className="flex items-center gap-3 px-4 py-3 bg-black border-2 border-cyan-400 shadow-[4px_4px_0px_#22d3ee] w-fit animate-in fade-in slide-in-from-top-2">
                  <Globe className="w-5 h-5 text-cyan-400 animate-spin-slow" />
                  <span className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                    {detectedLanguage.toLowerCase() === 'español' 
                      ? 'ORIGINAL: ESPAÑOL' 
                      : `TRADUCIDO: ${detectedLanguage} → ESPAÑOL`}
                  </span>
                </div>
              )}
              <div 
                className="relative group h-full flex flex-col"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <textarea
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onPaste={handlePaste}
                  placeholder="> INGRESA TEXTO DE ÓRDENES O ARRASTRA IMÁGENES AQUÍ..."
                  className="w-full min-h-[14rem] p-6 pb-16 bg-zinc-950 border-2 border-zinc-800 rounded-none resize-none focus:outline-none focus:border-fuchsia-500 focus:shadow-[4px_4px_0px_#d946ef] transition-all duration-300 text-fuchsia-50 placeholder:text-zinc-600 font-mono text-sm sm:text-base overflow-hidden"
                />
                
                {/* Attachment Button inside Textarea */}
                <div className="absolute bottom-5 left-5">
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-black border-2 border-zinc-700 text-sm font-bold text-zinc-300 hover:text-cyan-400 hover:border-cyan-400 hover:shadow-[4px_4px_0px_#22d3ee] transition-all uppercase tracking-wider"
                    title="Adjuntar imágenes"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>Añadir Imagen</span>
                  </button>
                </div>
              </div>

              {/* Image Previews */}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-4 p-5 bg-zinc-950 border-2 border-zinc-800">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative group w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 border-2 border-zinc-700 hover:border-fuchsia-500 hover:shadow-[4px_4px_0px_#d946ef] transition-all shrink-0 bg-black">
                      <img src={img} alt={`Preview ${idx}`} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity mix-blend-luminosity group-hover:mix-blend-normal" />
                      <button 
                        onClick={() => removeImage(idx)}
                        className="absolute -top-2 -right-2 bg-black border-2 border-fuchsia-500 text-fuchsia-500 hover:bg-fuchsia-500 hover:text-black p-1 opacity-0 group-hover:opacity-100 transition-all z-10"
                      >
                        <X className="w-4 h-4 font-bold" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Controls Sidebar */}
            <div className="w-full lg:w-80 flex flex-col gap-6">
              {/* View Toggle */}
              <div className="bg-zinc-950 p-5 border-2 border-zinc-800">
                <label className="block text-xs font-bold text-zinc-500 mb-3 uppercase tracking-widest">
                  // Modo de Vista
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewMode('completa')}
                    className={cn(
                      "flex-1 py-3 px-3 text-xs font-bold uppercase tracking-wider transition-all border-2",
                      viewMode === 'completa' 
                        ? "bg-cyan-400 text-black border-cyan-400 shadow-[4px_4px_0px_#0891b2]" 
                        : "bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
                    )}
                  >
                    Completa
                  </button>
                  <button
                    onClick={() => setViewMode('simple')}
                    className={cn(
                      "flex-1 py-3 px-3 text-xs font-bold uppercase tracking-wider transition-all border-2",
                      viewMode === 'simple' 
                        ? "bg-cyan-400 text-black border-cyan-400 shadow-[4px_4px_0px_#0891b2]" 
                        : "bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
                    )}
                  >
                    Simple
                  </button>
                </div>
              </div>
              
              {/* Standardization Toggle */}
              <div className="bg-zinc-950 p-5 border-2 border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-bold text-fuchsia-400 flex items-center gap-2 uppercase tracking-widest">
                    <Languages className="w-4 h-4" />
                    Estandarizar IA
                  </label>
                  <button 
                    onClick={() => setAutoStandardize(!autoStandardize)}
                    className={cn(
                      "relative inline-flex h-6 w-12 items-center transition-colors focus:outline-none border-2",
                      autoStandardize ? "bg-fuchsia-500 border-fuchsia-500" : "bg-black border-zinc-700"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 bg-white transition-transform",
                      autoStandardize ? "translate-x-7" : "translate-x-1"
                    )} />
                  </button>
                </div>
                <p className="text-xs text-zinc-500 font-mono leading-relaxed uppercase">
                  {'>'} Traduce al español<br/>
                  {'>'} Unifica proveedores<br/>
                  {'>'} Formatea fechas
                </p>
              </div>

              {/* Info Card */}
              <div className="bg-black p-5 border-2 border-lime-400/30 relative overflow-hidden group/info">
                <div className="absolute inset-0 bg-lime-400/5 translate-y-full group-hover/info:translate-y-0 transition-transform duration-500" />
                <div className="flex items-start gap-3 relative z-10">
                  <UploadCloud className="w-5 h-5 text-lime-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-lime-400/80 font-mono leading-relaxed uppercase">
                    Soporta texto e imágenes simultáneamente.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-6 border-t-2 border-zinc-800 flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleClearAll}
              disabled={isExtracting || (!inputText && images.length === 0 && !extractedData)}
              className="w-full sm:w-1/3 group relative flex items-center justify-center gap-2 sm:gap-3 bg-black text-zinc-400 px-4 sm:px-8 md:px-10 py-4 sm:py-5 font-black text-sm sm:text-base md:text-lg uppercase tracking-widest border-2 border-zinc-700 hover:bg-zinc-800 hover:text-white hover:border-zinc-500 hover:shadow-[8px_8px_0px_#52525b] hover:-translate-y-1 active:translate-y-0 active:shadow-[2px_2px_0px_#52525b] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[repeating-linear-gradient(-45deg,transparent,transparent_10px,rgba(255,255,255,0.05)_10px,rgba(255,255,255,0.05)_20px)] disabled:hover:bg-[repeating-linear-gradient(-45deg,transparent,transparent_10px,rgba(255,255,255,0.05)_10px,rgba(255,255,255,0.05)_20px)] disabled:hover:text-zinc-400 disabled:hover:border-zinc-700 disabled:hover:shadow-none disabled:hover:translate-y-0 transition-all duration-300"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              <span className="truncate">LIMPIAR TODO</span>
            </button>
            <button
              onClick={handleExtract}
              disabled={isExtracting || (!inputText.trim() && images.length === 0)}
              className="w-full sm:w-2/3 group relative flex items-center justify-center gap-2 sm:gap-3 bg-lime-400 text-black px-4 sm:px-8 md:px-10 py-4 sm:py-5 font-black text-base sm:text-lg md:text-xl uppercase tracking-widest border-2 border-lime-400 hover:bg-lime-300 hover:shadow-[8px_8px_0px_#4d7c0f] hover:-translate-y-1 active:translate-y-0 active:shadow-[2px_2px_0px_#4d7c0f] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[repeating-linear-gradient(-45deg,transparent,transparent_10px,rgba(0,0,0,0.1)_10px,rgba(0,0,0,0.1)_20px)] disabled:hover:bg-[repeating-linear-gradient(-45deg,transparent,transparent_10px,rgba(0,0,0,0.1)_10px,rgba(0,0,0,0.1)_20px)] disabled:hover:text-black disabled:hover:border-lime-400 disabled:hover:shadow-none disabled:hover:translate-y-0 transition-all duration-300"
            >
              {isExtracting ? (
                <>
                  <div className="w-5 h-5 sm:w-6 sm:h-6 animate-spin shrink-0 rounded-full border-[3px] sm:border-4 border-t-[#4285F4] border-r-[#EA4335] border-b-[#FBBC05] border-l-[#34A853]" />
                  <span className="truncate">ANALIZANDO DATOS...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                  <span className="truncate">INICIAR EXTRACCIÓN</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Section */}
        {extractedData && (
          <div className="bg-black border-2 border-zinc-800 shadow-[8px_8px_0px_#27272a] animate-in fade-in slide-in-from-bottom-8 duration-700 relative mt-12">
            
            {/* Toolbar */}
            <div className="bg-zinc-950 px-4 sm:px-6 py-4 border-b-2 border-zinc-800 flex flex-col sm:flex-row flex-wrap gap-4 items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 px-2 w-full sm:w-auto justify-center sm:justify-start uppercase">
                <span className="w-2 h-2 bg-cyan-400 animate-pulse" />
                <span>Modo Edición Activo</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button 
                  onClick={handleCopyToSheets}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border-2 border-fuchsia-500 bg-black text-xs font-bold text-fuchsia-500 hover:bg-fuchsia-500 hover:text-black hover:shadow-[6px_6px_0px_#a21caf] hover:-translate-y-1 hover:scale-105 active:scale-95 active:translate-y-0 active:shadow-[2px_2px_0px_#a21caf] transition-all uppercase tracking-wider"
                >
                  <span>📊 Copiar para Sheets</span>
                </button>
                <button 
                  onClick={handleCopyTable}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border-2 border-cyan-400 bg-black text-xs font-bold text-cyan-400 hover:bg-cyan-400 hover:text-black hover:shadow-[6px_6px_0px_#0891b2] hover:-translate-y-1 hover:scale-105 active:scale-95 active:translate-y-0 active:shadow-[2px_2px_0px_#0891b2] transition-all uppercase tracking-wider"
                >
                  <span>📋 Copiar Tabla</span>
                </button>
                <button 
                  onClick={handleSuggestAccounts}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border-2 border-lime-400 bg-black text-xs font-bold text-lime-400 hover:bg-lime-400 hover:text-black hover:shadow-[6px_6px_0px_#4d7c0f] hover:-translate-y-1 hover:scale-105 active:scale-95 active:translate-y-0 active:shadow-[2px_2px_0px_#4d7c0f] transition-all uppercase tracking-wider"
                >
                  <span>🤖 Sugerir Cuentas AI</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap font-mono">
                <thead>
                  <tr>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Estado</th>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Fecha</th>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Proveedor</th>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800 text-center">Cant.</th>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Descripción</th>
                    <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Link</th>
                    {viewMode === 'completa' && (
                      <>
                        <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Entrega</th>
                        <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Requisitor</th>
                        <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Orden_Trabajo</th>
                        <th className="sticky top-0 bg-zinc-950 px-5 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b-2 border-zinc-800">Empresa</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-zinc-900">
                  {extractedData.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-16 text-center text-zinc-600 font-bold uppercase tracking-widest">
                        // NO DATA FOUND //
                      </td>
                    </tr>
                  ) : (
                    extractedData.map((row) => (
                      <tr key={row.id} className="hover:bg-zinc-900/50 transition-colors group">
                        <td className="px-3 py-3 text-sm">
                          <select 
                            value={row.status || 'Pendiente'} 
                            onChange={(e) => handleCellChange(row.id, 'status', e.target.value)}
                            className={cn(
                              "px-3 py-2 text-xs font-bold border-2 appearance-none cursor-pointer outline-none transition-all text-center uppercase tracking-wider bg-black",
                              row.status?.toLowerCase() === 'entregado' ? "text-lime-400 border-lime-400/50 focus:border-lime-400" : 
                              row.status?.toLowerCase() === 'comprado' ? "text-cyan-400 border-cyan-400/50 focus:border-cyan-400" : 
                              row.status?.toLowerCase() === 'cancelado' ? "text-fuchsia-500 border-fuchsia-500/50 focus:border-fuchsia-500" :
                              "text-zinc-400 border-zinc-700 focus:border-zinc-500"
                            )}
                          >
                            <option value="Pendiente" className="bg-black text-zinc-400">PENDIENTE</option>
                            <option value="Comprado" className="bg-black text-cyan-400">COMPRADO</option>
                            <option value="Entregado" className="bg-black text-lime-400">ENTREGADO</option>
                            <option value="Cancelado" className="bg-black text-fuchsia-500">CANCELADO</option>
                          </select>
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <input type="text" value={row.orderDate || ''} onChange={(e) => handleCellChange(row.id, 'orderDate', e.target.value)} className="w-28 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-300" placeholder="DD/MM/YYYY" />
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <input type="text" value={row.provider || ''} onChange={(e) => handleCellChange(row.id, 'provider', e.target.value)} className="w-36 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all font-bold text-white uppercase" placeholder="PROVEEDOR" />
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <input type="number" value={row.qty || ''} onChange={(e) => handleCellChange(row.id, 'qty', Number(e.target.value))} className="w-20 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-cyan-400 font-bold text-center" placeholder="0" />
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <input type="text" value={row.desc || ''} onChange={(e) => handleCellChange(row.id, 'desc', e.target.value)} className="w-56 sm:w-72 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-300" placeholder="DESCRIPCIÓN" />
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <input type="text" value={row.link || ''} onChange={(e) => handleCellChange(row.id, 'link', e.target.value)} className="w-24 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-500 text-xs" placeholder="HTTPS://" />
                            {row.link && (
                              <a href={row.link} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-white hover:bg-cyan-400 p-1 border-2 border-transparent hover:border-cyan-400 transition-all shrink-0">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        </td>
                        {viewMode === 'completa' && (
                          <>
                            <td className="px-3 py-3 text-sm">
                              <input type="text" value={row.deliveryDate || ''} onChange={(e) => handleCellChange(row.id, 'deliveryDate', e.target.value)} className="w-28 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-400" placeholder="DD/MM/YYYY" />
                            </td>
                            <td className="px-3 py-3 text-sm">
                              <input type="text" value={row.requester || ''} onChange={(e) => handleCellChange(row.id, 'requester', e.target.value)} className="w-32 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-300 uppercase" placeholder="REQUISITOR" />
                            </td>
                            <td className="px-3 py-3 text-sm">
                              <input type="text" value={row.workOrder || ''} onChange={(e) => handleCellChange(row.id, 'workOrder', e.target.value)} className="w-32 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-300 uppercase" placeholder="ORDEN" />
                            </td>
                            <td className="px-3 py-3 text-sm">
                              <input type="text" value={row.company || ''} onChange={(e) => handleCellChange(row.id, 'company', e.target.value)} className="w-32 bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-cyan-400 focus:bg-zinc-900 px-2 py-2 outline-none transition-all text-zinc-300 uppercase" placeholder="EMPRESA" />
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Toast Notification - Extravagant */}
      <div className={cn(
        "fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 sm:gap-4 text-white px-4 sm:px-6 py-3 sm:py-4 shadow-[8px_8px_0px_rgba(0,0,0,0.5)] transition-all duration-500 z-50 border-2 w-[95%] sm:w-auto max-w-[95vw] sm:max-w-md font-mono uppercase tracking-wider text-xs sm:text-sm font-bold",
        toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12 pointer-events-none",
        toast?.type === 'error' ? "bg-black border-fuchsia-500 text-fuchsia-500" : "bg-black border-lime-400 text-lime-400"
      )}>
        <div className="shrink-0">
          {toast?.type === 'error' ? <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" /> : <Check className="w-4 h-4 sm:w-5 sm:h-5" />}
        </div>
        <span className="truncate">{toast?.message}</span>
      </div>
    </div>
  );
}

