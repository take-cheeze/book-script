#!/usr/bin/env node

const cheerio = require('cheerio'),
      fetch = require('node-fetch'),
      fs = require('fs'),
      csv = require('csv'),
      ISBN = require('isbn').ISBN;

const config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));
if (process.env.CALIL_APPKEY) {
    config.calil_api_key = process.env.CALIL_APPKEY;
}
const search_cache_path = `${__dirname}/search_cache.json`;

process.on('unhandledRejection', console.dir);

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
            const cache = search_cache[book.id][library];
            if (!already_found[book.id] && cache.status !== 'Error' && owned_in_library(cache)) {
                res.push([book.id, book.title, book.item.author, book.item.publisher,
                          book.item.release_date, book.item.pages, book.item.price || book.item.savedPrice,
                          cache.reserveurl, book.image_2x]);
                already_found[book.id] = true;
            }
        });

        console.log(`${library} books count: ${res.length - 1}`);
        csv.stringify(res, (err, output) => {
            if (err) { console.log(err); }
            fs.writeFileSync(`${__dirname}/result/${library}.csv`, output);
        });
        fs.writeFileSync(`${__dirname}/result/${library}.json`, to_json(res.slice(1, -1).map(csv_to_json)));
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
    csv.stringify(not_found, (err, output) => {
        if (err) { console.log(err); }
        fs.writeFileSync(`${__dirname}/result/should_buy.csv`, output);
    });
    fs.writeFileSync(`${__dirname}/result/should_buy.json`, to_json(not_found.slice(1, -1).map(csv_to_json)));
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
    fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&isbn=${isbns.join(',')}&systemid=${config.libraries.join(',')}&format=json&callback=no`)
        .then((v) => v.json())
        .then((json) => {
            continue_session(json, books, table, search_cache);
        });
}

function continue_session(session, books, table, search_cache) {
    if (session.continue === 1) {
        process.stdout.write('.');
        fetch(`https://api.calil.jp/check?appkey=${config.calil_api_key}&session=${session.session}&format=json&callback=no`)
            .then((v) => v.json())
            .then((json) => {
                setTimeout(() => { continue_session(json, books, table, search_cache); },
                           config.search_interval);
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

// Check calil api key works
fetch(`https://api.calil.jp/library?appkey=${config.calil_api_key}&geocode=136.7163027,35.390516&limit=1&format=json&callback=`).then((v) => v.text())
    .then((body) => {
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
                                console.log(`Wanted books total count: ${res.length}`);
                                fs.writeFileSync(`${__dirname}/result/wanted_books.json`, to_json(res));
                                search_libraries(res);
                            }
                        });
                });
            });
    });
