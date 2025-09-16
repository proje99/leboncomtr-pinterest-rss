const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Shopify API sınıfı
class SimpleShopifyAPI {
  constructor(shopDomain, accessToken) {
    this.baseURL = `https://${shopDomain}/admin/api/2023-10`;
    this.headers = {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    };
  }

  async getAllProducts() {
    try {
      const response = await axios.get(`${this.baseURL}/products.json`, {
        headers: this.headers,
        params: {
          limit: 250,
          status: 'active',
          published_status: 'published'
        }
      });
      return response.data.products;
    } catch (error) {
      console.error('Ürünler getirilirken hata:', error.response?.data || error.message);
      throw error;
    }
  }
}

// RSS Generator sınıfı
class SimpleRSSGenerator {
  generateRSS(products, config = {}) {
    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ', newline: '\n' }
    });

    const rssObject = {
      rss: {
        $: {
          version: '2.0',
          'xmlns:media': 'http://search.yahoo.com/mrss/',
          'xmlns:dc': 'http://purl.org/dc/elements/1.1/'
        },
        channel: {
          title: config.title || 'Mağaza Ürünleri',
          description: config.description || 'Mağazamızdaki tüm ürünler',
          link: config.link || 'https://shop.myshopify.com',
          language: config.language || 'tr',
          lastBuildDate: new Date().toUTCString(),
          generator: 'Simple Shopify RSS Generator',
          item: products.map(product => this.createRSSItem(product, config))
        }
      }
    };

    return builder.buildObject(rssObject);
  }

  createRSSItem(product, config = {}) {
    const baseUrl = config.link || 'https://shop.myshopify.com';
    const item = {
      title: product.title,
      description: this.cleanDescription(product.body_html || product.description),
      link: `${baseUrl}/products/${product.handle}`,
      guid: {
        $: { isPermaLink: 'true' },
        _: `${baseUrl}/products/${product.handle}`
      },
      pubDate: new Date(product.updated_at).toUTCString(),
      'dc:creator': config.title || 'Mağaza Ürünleri'
    };

    // Ürün görsellerini ekle
    if (product.images && product.images.length > 0) {
      item['media:content'] = product.images.map(image => ({
        $: {
          url: image.src,
          type: 'image/jpeg',
          medium: 'image'
        }
      }));

      item['media:thumbnail'] = {
        $: {
          url: product.images[0].src
        }
      };
    }

    // Fiyat bilgisi
    if (product.variants && product.variants.length > 0) {
      const variant = product.variants[0];
      item['media:price'] = {
        $: {
          currency: 'TRY'
        },
        _: variant.price
      };
    }

    // Kategori ve etiketler
    if (product.product_type) {
      item.category = product.product_type;
    }

    if (product.tags) {
      item['dc:subject'] = product.tags.split(',').map(tag => tag.trim());
    }

    return item;
  }

  cleanDescription(html) {
    if (!html) return '';
    
    let clean = html.replace(/<[^>]*>/g, '');
    clean = clean
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    
    clean = clean.replace(/\s+/g, ' ').trim();
    
    if (clean.length > 500) {
      clean = clean.substring(0, 497) + '...';
    }
    
    return clean;
  }
}

// Ana sayfa
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Shopify RSS Generator',
    message: 'RSS feed\'inizi almak için /rss endpoint\'ini kullanın'
  });
});

// RSS feed endpoint'i
app.get('/rss', async (req, res) => {
  try {
    console.log('RSS feed isteği alındı...');
    
    // Environment variables'dan shop bilgilerini al
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!shopDomain || !accessToken) {
      return res.status(500).json({ 
        error: 'Shopify konfigürasyonu eksik',
        message: 'SHOPIFY_SHOP_DOMAIN ve SHOPIFY_ACCESS_TOKEN environment variables\'larını ayarlayın'
      });
    }
    
    const shopifyAPI = new SimpleShopifyAPI(shopDomain, accessToken);
    const products = await shopifyAPI.getAllProducts();
    console.log(`${products.length} ürün bulundu`);
    
    const rssGenerator = new SimpleRSSGenerator();
    const rssFeed = rssGenerator.generateRSS(products, {
      title: process.env.RSS_TITLE || 'Mağaza Ürünleri',
      description: process.env.RSS_DESCRIPTION || 'Mağazamızdaki tüm ürünler',
      link: `https://${shopDomain}`,
      language: 'tr'
    });
    
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(rssFeed);
    
  } catch (error) {
    console.error('RSS feed oluşturulurken hata:', error);
    res.status(500).json({ 
      error: 'RSS feed oluşturulamadı', 
      message: error.message 
    });
  }
});

// Pinterest için özel RSS feed
app.get('/rss/pinterest', async (req, res) => {
  try {
    console.log('Pinterest RSS feed isteği alındı...');
    
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!shopDomain || !accessToken) {
      return res.status(500).json({ 
        error: 'Shopify konfigürasyonu eksik',
        message: 'SHOPIFY_SHOP_DOMAIN ve SHOPIFY_ACCESS_TOKEN environment variables\'larını ayarlayın'
      });
    }
    
    const shopifyAPI = new SimpleShopifyAPI(shopDomain, accessToken);
    const products = await shopifyAPI.getAllProducts();
    console.log(`${products.length} ürün bulundu`);
    
    const rssGenerator = new SimpleRSSGenerator();
    const rssFeed = rssGenerator.generateRSS(products, {
      title: process.env.RSS_TITLE || 'Mağaza Ürünleri',
      description: process.env.RSS_DESCRIPTION || 'Mağazamızdaki tüm ürünler',
      link: `https://${shopDomain}`,
      language: 'tr'
    });
    
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(rssFeed);
    
  } catch (error) {
    console.error('Pinterest RSS feed oluşturulurken hata:', error);
    res.status(500).json({ 
      error: 'Pinterest RSS feed oluşturulamadı', 
      message: error.message 
    });
  }
});

// Ürün sayısını kontrol et
app.get('/api/products/count', async (req, res) => {
  try {
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!shopDomain || !accessToken) {
      return res.status(500).json({ 
        error: 'Shopify konfigürasyonu eksik',
        message: 'SHOPIFY_SHOP_DOMAIN ve SHOPIFY_ACCESS_TOKEN environment variables\'larını ayarlayın'
      });
    }
    
    const shopifyAPI = new SimpleShopifyAPI(shopDomain, accessToken);
    const products = await shopifyAPI.getAllProducts();
    res.json({ 
      count: products.length,
      message: `${products.length} aktif ürün bulundu`
    });
  } catch (error) {
    console.error('Ürün sayısı alınırken hata:', error);
    res.status(500).json({ 
      error: 'Ürün sayısı alınamadı', 
      message: error.message 
    });
  }
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Simple Shopify RSS Generator'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Sayfa bulunamadı',
    message: 'Aradığınız sayfa mevcut değil.'
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Sunucu hatası:', error);
  res.status(500).json({ 
    error: 'Sunucu hatası', 
    message: error.message 
  });
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 Simple Shopify RSS Generator başlatıldı!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Ana Sayfa: http://localhost:${PORT}`);
  console.log(`📌 RSS Feed: http://localhost:${PORT}/rss`);
  console.log(`📌 Pinterest RSS: http://localhost:${PORT}/rss/pinterest`);
  console.log(`📊 Ürün Sayısı: http://localhost:${PORT}/api/products/count`);
  console.log(`\n📝 Environment Variables:`);
  console.log(`   SHOPIFY_SHOP_DOMAIN=${process.env.SHOPIFY_SHOP_DOMAIN || 'AYARLANMADI'}`);
  console.log(`   SHOPIFY_ACCESS_TOKEN=${process.env.SHOPIFY_ACCESS_TOKEN ? 'AYARLANDI' : 'AYARLANMADI'}`);
  console.log(`\n🔧 .env dosyası oluşturun ve Shopify bilgilerinizi ekleyin!`);
});

module.exports = app;