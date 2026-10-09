#!/usr/bin/env node

const fetch = globalThis.fetch || require('node-fetch'),
      fs = require('fs'),
      { stringify } = require('csv/sync'),
      ISBN = require('isbn').ISBN;

const config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));
if (process.env.CALIL_APPKEY) {
    config.calil_api_key = process.env.CALIL_APPKEY;
}
const search_cache_path = `${__dirname}/search_cache.json`;

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Referer': `https://booklog.jp/users/${config.booklog_id}`
};

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
    process.exit(1);
});

function owned_in_library(cache_ent) {
    return Object.keys(cache_ent.libkey).length > 0;
}

const to_json = (obj) => { return JSON.stringify(obj, null, 2); };
const csv_to_json = (ary) => {
    return {
        isbn: ary[0],
        title: ary[1],
        author: ary[2],
        publisher: ary[3],
        release_date: ary[4],
        pages: ary[5],
        price: ary[6],
        reserve_url: ary[7],
        image_url: ary[8],
    }
}

function output_book_list() {
    const search_cache = JSON.parse(fs.readFileSync(`${__dirname}/search_cache.json`));
    const books = JSON.parse(fs.readFileSync(`${__dirname}/result/wanted_books.json`));

    const already_found = {};
    const csv_header = ['ISBN', '題名', '著者', '出版社', '刊行', 'ページ数', '値段', '予約URL', '画像URL'];

    config.libraries.forEach((library) => {
        const res = [csv_header];
        books.forEach((book) => {
            const bookCache = search_cache[book.id];
            if (!bookCache) return; // not yet searched, skip
            const cache = bookCache[library];
            if (!cache) return; // library not in cache for this book
            if (!already_found[book.id] && cache.status !== 'Error' && owned_in_library(cache)) {
                res.push([book.id, book.title, book.item.author, book.item.publisher,
                          book.item.release_date, book.item.pages, book.item.price || book.item.savedPrice,
                          cache.reserveurl, book.image_2x]);
                already_found[book.id] = true;
            }
        });

        console.log(`${library} books count: ${res.length - 1}`);
        const output = stringify(res);
        fs.writeFileSync(`${__dirname}/result/${library}.csv`, output);
        fs.writeFileSync(`${__dirname}/result/${library}.json`, to_json(res.slice(1).map(csv_to_json)));
    });

    const not_found = [csv_header];
    let price_sum = 0;
    books.forEach((book) => {
        if (!already_found[book.id]) {
            const isbn = ISBN.parse(book.id);
            const url = isbn
                  ? `http://book.tsuhankensaku.com/hon/isbn/${isbn.asIsbn13()}/`
                  : `http://book.tsuhankensaku.com/hon/?q=${book.id}&t=booksearch`;
            let price = book.item.price || book.item.savedPrice;
            not_found.push([book.id, book.title, book.item.author, book.item.publisher,
                            book.item.release_date, book.item.pages, price,
                            url, book.image_2x]);

            price = price || '0';
            if (isNaN(price)) {
                price = price.replace(/^￥ /, '').replace(/,/g, '');
            }
            price_sum += parseInt(price);
        }
    });

    console.log(`Books not in library count: ${not_found.length - 1}`);
    console.log(`Need ￥${price_sum.toLocaleString()} to buy all books not in library.`);
    const output = stringify(not_found);
    fs.writeFileSync(`${__dirname}/result/should_buy.csv`, output);
    fs.writeFileSync(`${__dirname}/result/should_buy.json`, to_json(not_found.slice(1).map(csv_to_json)));
}

function search_libraries(books, table = null, search_cache = null) {
    if (!table) {
        table = books.reduce((res, v) => { res[v.id] = v; return res; }, {});
    }
    if (!search_cache && fs.existsSync(search_cache_path)) {
        search_cache = JSON.parse(fs.readFileSync(search_cache_path));

        const cur_year = new Date().getFullYear();

        // filter books in search cache
        books = books.filter((v) => {
            const c = search_cache[v.id];
            if (c) {
                for (const l of config.libraries) {
                    if (!(l in c)) { return true; }
                }

                for (const k in c) {
                    if (c[k].status !== 'OK') { return false; }
                }
                const own_libs = Object.keys(c).filter((v) => owned_in_library(c[v]));
                if (own_libs.length > 0) { return false; }

                if (v.item.release_date) {
                    const book_year = parseInt(v.item.release_date.split('-')[0]);
                    if ((cur_year - book_year) > config.old_book_threshold) { return false; }
                }
            }
            return true;
        });
    }
    else { search_cache = search_cache || {} };

    // no books to search
    if (books.length === 0) {
        fs.writeFileSync(search_cache_path, to_json(search_cache));
        output_book_list();
        return;
    }

    const isbns = books.splice(0, config.per_search).map((v) => v.id);
    console.log(`searching ISBNs (${books.length} left): ${isbns}`);
    fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&isbn=${isbns.join(',')}&systemid=${config.libraries.join(',')}&format=json&callback=no`, { headers: DEFAULT_HEADERS })
        .then((v) => v.json())
        .then((json) => {
            continue_session(json, books, table, search_cache);
        })
        .catch((err) => {
            console.error('Error querying Calil API:', err);
            process.exit(1);
        });
}

function continue_session(session, books, table, search_cache) {
    if (session.continue === 1) {
        process.stdout.write('.');
        fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&session=${session.session}&format=json&callback=no`, { headers: DEFAULT_HEADERS })
            .then((v) => v.json())
            .then((json) => {
                setTimeout(() => { continue_session(json, books, table, search_cache); },
                           config.search_interval);
            })
            .catch((err) => {
                console.error('Error continuing Calil session:', err);
                process.exit(1);
            });
    } else {
        console.log('');
        for(let isbn in session.books) {
            search_cache[isbn] = session.books[isbn];
        }
        fs.writeFileSync(search_cache_path, to_json(search_cache));
        setTimeout(() => {
            search_libraries(books, table, search_cache);
        }, config.search_interval);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetch_wanted_books() {
    const MAX_RETRIES = 3;

    // Try the primary paginated endpoint, retrying on 202 (WAF challenge)
    async function fetch_page(page) {
        const url = `https://booklog.jp/users/${config.booklog_id}/all?category_id=all&status=1&json=true&page=${page}`;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const res = await fetch(url, { headers: DEFAULT_HEADERS });
            if (res.status === 202) {
                console.warn(`Received 202 (WAF challenge) from ${url}, attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
                console.warn('Response headers:', Object.fromEntries(res.headers.entries()));
                if (attempt >= MAX_RETRIES) {
                    return null; // signal fallback needed
                }
                await sleep(2000);
                continue;
            }
            if (!res.ok) {
                throw new Error(`Failed to fetch booklog page ${page}: ${res.status} ${res.statusText}`);
            }
            const text = await res.text();
            if (!text.trim()) {
                throw new Error(`Empty response from ${url} (status: ${res.status})`);
            }
            try {
                return JSON.parse(text);
            } catch (err) {
                console.error(`Invalid JSON from ${url} (status ${res.status}):`, text.slice(0, 500));
                throw err;
            }
        }
        return null;
    }

    // Try primary endpoint with pagination
    let books = [];
    let page = 1;
    let usedFallback = false;
    while (true) {
        const data = await fetch_page(page);
        if (data === null) {
            // Persistent 202 — fall back to alternative API
            console.warn(`Falling back to alternative API after persistent 202 responses.`);
            usedFallback = true;
            break;
        }
        if (!data.books || data.books.length === 0) {
            break;
        }
        books = books.concat(data.books);
        page++;
        if (config.search_interval) {
            await sleep(config.search_interval);
        }
    }

    if (usedFallback) {
        const altUrl = `https://api.booklog.jp/v2/json/${config.booklog_id}?status=1&count=200`;
        console.info(`Fetching from alternative endpoint: ${altUrl}`);
        const altRes = await fetch(altUrl, { headers: DEFAULT_HEADERS });
        if (!altRes.ok) {
            throw new Error(`Alternative API failed: ${altRes.status} ${altRes.statusText}`);
        }
        const altData = await altRes.json();
        if (!altData.books || !Array.isArray(altData.books)) {
            throw new Error('Alternative API returned unexpected data');
        }
        // Normalize sparse alternative-API books into the shape expected by downstream code.
        // Primary API shape: { id (ISBN), title, image, image_2x, item: { author, publisher, ... } }
        // Alternative API shape: { url, title, image, catalog }
        // The ISBN is the last path segment of the URL: .../archives/1/<ISBN>
        books = altData.books.map((b) => {
            const id = b.url ? b.url.split('/').pop() : '';
            return {
                id,
                title: b.title || '',
                image: b.image || '',
                image_2x: b.image || '',
                item: {
                    author: '',
                    publisher: '',
                    release_date: null,
                    pages: null,
                    price: null,
                    savedPrice: null,
                },
            };
        }).filter(b => b.id); // discard any entries where we couldn't extract an ISBN
    }

    return books;
}

(async () => {
    try {
        fs.mkdirSync(`${__dirname}/result`, { recursive: true });
        const books = await fetch_wanted_books();
        console.log(`Wanted books total count: ${books.length}`);
        fs.writeFileSync(`${__dirname}/result/wanted_books.json`, to_json(books));
        search_libraries(books);
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
})();
