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

// Root Route
app.get('/', (req, res) => {
    res.json({
        status: true,
        creator: "IMALSHA API",
        site: "cinesubz",
        endpoints: {
            search: "/api/v1/cinesubz/search?q=movie_name",
            infodl: "/api/v1/cinesubz/infodl?url=movie_url"
        }
    });
});

// Search Endpoint for Cinesubz
app.get('/api/v1/cinesubz/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ status: false, message: "Search term required" });

        const searchUrl = "https://cinesubz.co/?s=" + encodeURIComponent(query);
        const response = await axios.get(searchUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);
        const results = [];

        $('.posts-row .item, article, .result-item').each((i, el) => {
            const linkEl = $(el).find('a').first();
            const href = linkEl.attr('href') || '';
            const title = $(el).find('.title, h3, h2').text().trim() || linkEl.attr('title') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';

            if (href && title) {
                if (!results.some(r => r.link === href)) {
                    results.push({ title, image: img, link: href });
                }
            }
        });

        res.json({ status: true, creator: "IMALSHA API", site: "cinesubz", results_count: results.length, data: results });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

// Info & Download Endpoint for Cinesubz
app.get('/api/v1/cinesubz/infodl', async (req, res) => {
    try {
        const movieUrl = req.query.url;
        if (!movieUrl) return res.status(400).json({ status: false, message: "URL required" });

        const response = await axios.get(movieUrl, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let title = $('h1').first().text().trim();
        let image = $('meta[property="og:image"]').attr('content') || '';
        let story = $('.entry-content p').first().text().trim() || 'No description';

        const downloads = [];
        
        // Scrape download links from Cinesubz
        $('a.download-button, .dl-links a, .btn-download, a[href*="pixeldrain"], a[href*="mega"], a[href*="zippyshare"]').each((i, el) => {
            const href = $(el).attr('href');
            const name = $(el).text().trim() || "Download File";

            if (href && !downloads.some(d => d.link === href)) {
                downloads.push({
                    name: name,
                    link: href,
                    direct_link: href
                });
            }
        });

        res.json({
            status: true,
            creator: "IMALSHA API",
            site: "cinesubz",
            data: {
                title,
                image,
                story,
                downloads
            }
        });

    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Cinesubz API running on port ${PORT}`));
