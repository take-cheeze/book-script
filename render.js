#!/usr/bin/env node

const fs = require('fs'),
      csv_parse = require('csv-parse/lib/sync'),
      _ = require('underscore');

const config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));

const index_template = `
<!doctype html>
<html lang="en">
  <head>
    <!-- Required meta tags -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" integrity="sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z" crossorigin="anonymous">

    <title>Library List</title>
  </head>
  <body>
    <h1>Book shelf: <a href="https://booklog.jp/users/<%= config.booklog_id %>"><%= config.booklog_id %></a></h1>
    <h1>Library List</h1>

    <ul class="list-group">
      <% for (const l of config.libraries) { %>
        <li class="list-group-item"><a href="./<%= l %>.html"><%= l %></a></li>
      <% } %>
      <li class="list-group-item"><a href="./should_buy.html">Should buy</a></li>
    </ul>

    <!-- Optional JavaScript -->
    <!-- jQuery first, then Popper.js, then Bootstrap JS -->
    <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js" integrity="sha384-DfXdz2htPH0lsSSs5nCTpuj/zy4C+OGpamoFVy38MVBnE+IbbVYUew+OrCXaRkfj" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.1/dist/umd/popper.min.js" integrity="sha384-9/reFTGAW83EW2RDu2S0VKaIzap3H66lZH81PoYlFhbGU+6BZp6G7niu735Sk7lN" crossorigin="anonymous"></script>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js" integrity="sha384-B4gt1jrGC7Jh4AgTPSdUtOBvfO8shuf57BaghqFfPlYxofvL8/KUEfYiJOMMV+rV" crossorigin="anonymous"></script>
  </body>
</html>
`;

fs.writeFileSync(`${__dirname}/docs/index.html`, _.template(index_template)({'config': config}));

const library_template = `
<!doctype html>
<html lang="en">
  <head>
    <!-- Required meta tags -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" integrity="sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z" crossorigin="anonymous">

    <title>Book List: <%= library %></title>
  </head>
  <body>
    <h1>Book List: <%= library %></h1>

    <table class="table">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">Title</th>
          <th scope="col">Author</th>
          <th scope="col">Pages</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <% for (const b of books) { %>
          <tr>
            <td>
              <% if (b['画像URL']) { %>
                <a href="https://booklog.jp/item/1/<%= b['ISBN'] %>">
                  <img alt="<%= b['題名'] %>" src="<%= b['画像URL'] %>" height="100" />
                </a>
              <% } %>
            </td>
            <td><a href="https://booklog.jp/item/1/<%= b['ISBN'] %>"><%= b['題名'] %></a></td>
            <td><a href="https://booklog.jp/author/<%= encodeURI(b['著者']) %>"><%= b['著者'] %></a></td>
            <td><%= b['ページ数'] %></td>
            <td>
              <a href="https://calil.jp/book/<%= b['ISBN'] %>" target="_blank" class="btn btn-info">Calil</a>
              <% if (library !== "should_buy") { %>
                <a href="<%= b['予約URL'] %>" target="_blank" class="btn btn-primary">Reserve</a>
              <% } else { %>
                <a href="https://amazon.co.jp/dp/<%= b['ISBN'] %>" target="_blank" class="btn btn-warning">Amazozn</a>
                <a href="https://www.e-hon.ne.jp/bec/SA/Forward?spKeyword=<%= b['ISBN'] %>&button=btnSpeed&mode=kodawari_header&ctlB9Flg=1" target="_blank" class="btn btn-info">e-hon</a>
              <% } %>
            </td>
          </tr>
        <% } %>
      </tbody>
    </table>

    <!-- Optional JavaScript -->
    <!-- jQuery first, then Popper.js, then Bootstrap JS -->
    <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js" integrity="sha384-DfXdz2htPH0lsSSs5nCTpuj/zy4C+OGpamoFVy38MVBnE+IbbVYUew+OrCXaRkfj" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.1/dist/umd/popper.min.js" integrity="sha384-9/reFTGAW83EW2RDu2S0VKaIzap3H66lZH81PoYlFhbGU+6BZp6G7niu735Sk7lN" crossorigin="anonymous"></script>
    <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js" integrity="sha384-B4gt1jrGC7Jh4AgTPSdUtOBvfO8shuf57BaghqFfPlYxofvL8/KUEfYiJOMMV+rV" crossorigin="anonymous"></script>
  </body>
</html>
`;

config.libraries.push('should_buy');

for (const l of config.libraries) {
  let parsed = csv_parse(fs.readFileSync(`${__dirname}/result/${l}.csv`), { columns: true });
  parsed = _.sortBy(parsed, (v) => v['ISBN']);
  fs.writeFileSync(`${__dirname}/docs/${l}.html`, _.template(library_template)({'books': parsed, 'library': l}));
}
