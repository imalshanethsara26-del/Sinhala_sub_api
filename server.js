const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// Root Status Route
app.get('/', (req, res) => {
    res.json({
        status: true,
        message: "IMALSHA API is Live 🚀",
        endpoints: {
            search: "/api/v1/sinhalasub/search?q=movie_name",
            infodl: "/api/v1/sinhalasub/infodl?url=movie_url"
        }
    });
});

// Search Endpoint
app.get('/api/v1/sinhalasub/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ status: false, message: "Search term required" });

        const searchUrl = "https://sinhalasub.lk/?s=" + encodeURIComponent(query);
        const response = await axios.get(searchUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);
        const results = [];

        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            const parent = $(el).closest('article, .result-item, .item, div');
            
            let title = $(el).find('h2, h3, .title').text().trim();
            if (!title) title = $(el).attr('title') || '';
            if (!title) title = $(el).text().trim();

            let img = $(el).find('img').attr('src');
            if (!img) img = $(el).find('img').attr('data-src');
            if (!img) img = parent.find('img').attr('src');
            if (!img) img = parent.find('img').attr('data-src') || '';

            if (href.includes('sinhalasub.lk') && (href.includes('/movies/') || href.includes('/tvshows/')) && title.length > 2) {
                title = title.replace(/\t|\n/g, '').trim();
                if (!results.some(r => r.link === href)) {
                    results.push({ title, image: img, link: href });
                }
            }
        });

        res.json({ status: true, creator: "IMALSHA API", site: "sinhalasub", results_count: results.length, data: results });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

// Info & Download Endpoint
app.get('/api/v1/sinhalasub/infodl', async (req, res) => {
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

        const response = await axios.get(movieUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let title = $('h1').first().text().trim();
        if (!title) title = $('title').text().trim();

        let image = $('meta[property="og:image"]').attr('content');
        if (!image) image = $('.poster img, .single-poster img, article img, .entry-content img').first().attr('src') || '';

        // IMDb Rating
        let imdb_rating = $('.num, .rating, .imdb_rating, .score, .imdb, span[itemprop="ratingValue"]').first().text().trim();
        if (!imdb_rating) {
            const pageText = $.text();
            const match = pageText.match(/IMDb\s*:?\s*([\d\.]+(\/10)?)/i);
            if (match) imdb_rating = match[1];
        }
        if (!imdb_rating) imdb_rating = "N/A";

        // Main Quality
        let mainQuality = $('.quality, .mvoie-quality, .badge-quality, .quality-tag, .dt_quality').first().text().trim();
        if (!mainQuality) {
            const match = title.match(/(1080p|720p|480p|2160p|4K|WEB-DL|HDTV|BluRay|HD)/i);
            if (match) mainQuality = match[0];
        }
        if (!mainQuality) mainQuality = "HD / WEB-DL";

        let story = '';
        $('.entry-content p, .description p, article p').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length > 30 && !text.includes('උපසිරැසි') && !text.includes('Sinhala Subtitles')) {
                if (!story) story = text;
            }
        });
        if (!story) story = 'No description available';

        const downloads = [];

        // 1. Download Table Rows (tr) Scraping
        $('tr, .link-row, .dl-row').each((i, el) => {
            const linkEl = $(el).find('a');
            const href = linkEl.attr('href') || $(el).find('a[href]').attr('href') || '';
            
            if (href && (href.includes('/links/') || href.includes('pixeldrain') || href.includes('sinhalasub') || href.includes('telegram') || href.includes('filespayout') || href.includes('mega'))) {
                const rowText = $(el).text().replace(/\s+/g, ' ').trim();

                // Extract Quality (FHD 1080p, HD 720p, SD 480p, etc.)
                const qMatch = rowText.match(/(FHD\s*1080p|HD\s*720p|SD\s*480p|1080p|720p|480p|2160p|4K)/i);
                const quality = qMatch ? qMatch[0].toUpperCase() : "HD";

                // Extract Size (e.g. 2.30 GB, 632 MB)
                const sMatch = rowText.match(/(\d+(\.\d+)?\s*(GB|MB))/i);
                const size = sMatch ? sMatch[0] : "N/A";

                // Extract Server Name (Pixeldrain, DLServer-01, Telegram, etc.)
                let server = linkEl.text().trim() || "Download";
                if (server.length > 30 || !server) {
                    const serverMatch = rowText.match(/(Pixeldrain|DLServer-\d+|Telegram|FilesPayout|Mega)/i);
                    server = serverMatch ? serverMatch[0] : "Server";
                }

                const fullName = `🎥 [Movie File] ${server} - ${quality} (${size})`;

                if (!downloads.some(d => d.link === href)) {
                    downloads.push({
                        name: fullName,
                        quality: quality,
                        size: size,
                        link: href
                    });
                }
            }
        });

        // 2. Fallback for Links outside tables
        if (downloads.length === 0) {
            $('a').each((i, el) => {
                const href = $(el).attr('href') || '';
                if (href && (href.includes('/links/') || href.includes('pixeldrain') || href.includes('telegram')) && !href.includes('sinhalasub.lk/?s=')) {
                    const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim();
                    
                    const qMatch = parentText.match(/(FHD\s*1080p|HD\s*720p|SD\s*480p|1080p|720p|480p)/i);
                    const quality = qMatch ? qMatch[0].toUpperCase() : "HD";

                    const sMatch = parentText.match(/(\d+(\.\d+)?\s*(GB|MB))/i);
                    const size = sMatch ? sMatch[0] : "N/A";

                    let server = $(el).text().trim() || "Download";

                    if (!downloads.some(d => d.link === href)) {
                        downloads.push({
                            name: `🎥 [Movie File] ${server} - ${quality} (${size})`,
                            quality: quality,
                            size: size,
                            link: href
                        });
                    }
                }
            });
        }

        res.json({
            status: true,
            creator: "IMALSHA API",
            site: "sinhalasub",
            data: {
                title,
                imdb_rating,
                quality: mainQuality,
                image,
                story,
                downloads
            }
        });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
