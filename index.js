#!/usr/bin/env node

const cheerio = require('cheerio'),
      fetch = require('node-fetch'),
      fs = require('fs');

const config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));
const search_cache_path = `${__dirname}/search_cache.json`;

function search_libraries(books, table = null, search_cache = null) {
    if (!table) {
        table = books.reduce((res, v) => { res[v.id] = v; return res; }, {});
    }
    if (!search_cache && fs.existsSync(search_cache_path)) {
        search_cache = JSON.parse(fs.readFileSync(search_cache_path));

        // filter books in search cache
        books = books.filter((v) => !search_cache[v.id]);
    }
    search_cache = search_cache || {};

    // no books to search
    if (books.length === 0) {
        fs.writeFileSync(search_cache_path, JSON.stringify(search_cache));
        return;
    }

    const isbns = books.splice(0, config.per_search).map((v) => v.id);
    fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&isbn=${isbns.join(',')}&systemid=${config.libraries.join(',')}&format=json&callback=no`)
        .then((v) => v.json())
        .then((json) => {
            continue_session(json, books, table, search_cache);
        });
}

function continue_session(session, books, table, search_cache) {
    if (session.continue === 1) {
        fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&session=${session.session}&format=json&callback=no`)
            .then((v) => v.json())
            .then((json) => {
                setTimeout(() => { continue_session(json, books, table, search_cache); },
                           config.search_interval);
            });
    } else {
        for(let isbn in session.books) {
            search_cache[isbn] = session.books[isbn];
        }
        fs.writeFile(search_cache_path, JSON.stringify(search_cache));
        setTimeout(() => { search_libraries(books, table, search_cache); },
                   config.search_interval);
    }
}

fetch(`http://booklog.jp/users/${config.booklog_id}`).then((v) => v.text())
    .then((body) => {
        const $ = cheerio.load(body);
        const per_page = 25;
        const wanted = parseInt(JSON.parse($('#shelf')[0].attribs['data-shelf-stats']).statuses[1]);
        const booklog_len = Math.ceil(wanted / per_page);
        let res = [], count = 0;
        Array.apply(null, {length: booklog_len}).map(Number.call, Number).forEach((v) => {
            fetch(`http://booklog.jp/users/${config.booklog_id}/all?category_id=all&status=1&json=true&page=${v + 1}`)
                .then((v) => v.json())
                .then((v) => {
                    res = res.concat(v.books);
                    if (++count >= booklog_len) {
                        console.log(`wanted book count: ${res.length}`);
                        fs.writeFileSync(`${__dirname}/wanted_books.json`, JSON.stringify(res));
                        search_libraries(res);
                    }
                });
        });
    });
