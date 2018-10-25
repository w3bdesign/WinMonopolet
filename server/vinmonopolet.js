const vinmonopolet = require('vinmonopolet');
const scraper = require('./scraper.js');
var sqlite3 = require('sqlite3'),
    TransactionDatabase = require('sqlite3-transactions').TransactionDatabase;

let db = new TransactionDatabase(new sqlite3.Database('inv.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the inventory database.');
  db.run('CREATE TABLE IF NOT EXISTS stores (store_id INTEGER PRIMARY KEY, name TEXT NOT NULL, last_updated TEXT NOT NULL)', function(err) {
    if (err){
      console.log(err.message)
    }
  });
}));

//Some store names contain commas, this function checks if that is the case, if so, formats it for sqlite3.
function formatName(name) {
  if(name.includes(",")){
    return name.replace(/, /g, '_');
  } else {
    return name
  }
}


function createOrUpdate(store, exists){
  var date = new Date();
  if(exists){
    db.run('UPDATE stores SET last_updated = ? WHERE name = ?', [date,store])
  } else {
    db.run('INSERT INTO stores VALUES (?,?,?)', [null,store,date], function(err) {
      if (err){
        console.log(err.message)
      }
    })
  }
}

//Checks the store against the store table to see when it was last updated.
//If it exists and is fresher than a set threshold (tbd), select from DB, else getBeersByStore
function check_store(store){
  db.get('SELECT * FROM stores WHERE name=?', [store], (err, row) =>{
    if(err){
      console.log(err.message)
    } else {
      //If undefined, that store has not yet been added to the DB, thus we fetch all beers through the API
      if(row == undefined) {
        getFromVinmonopolet(store, false)
      } else {
        console.log(row)
      }
    }
  });
}

/*
Fetches all beers from the selected Vinmonopolet store (@param store) through the API
and inserts them into the database.

@Param exists tells the function if the table already exists. If true, update the last_updated on the corresponding store table,
if false, tells the function to create the corresponding table.
*/
async function getFromVinmonopolet(store, exists){
  const tableName = formatName(store)
  console.log("Querying store: "+tableName)
  db.run('CREATE TABLE IF NOT EXISTS '+tableName+' (id INTEGER PRIMARY KEY ON CONFLICT IGNORE, name TEXT NOT NULL, type TEXT NOT NULL, price REAL NOT NULL, score REAL NOT NULL, stockLevel INTEGER NOT NULL)');

  const facets = await vinmonopolet.getFacets();
  const storeFacet = facets.find(facet => facet.name === 'Butikker')
  const storeFacetValue = storeFacet.values.find(val => val.name === store)
  const beer = vinmonopolet.Facet.Category.BEER

  let {pagination, products} = await vinmonopolet.getProducts({facet: [storeFacetValue,beer]})
  /*
  TRANSACTION BEGINS HERE
  Due to the way transactions work with async, we need to do all the async operations (await) inside a new async function after
  starting the transaction function, thus the need for a nested function. A bit clunky, but it gets the job done.
*/
  db.beginTransaction(function(err, transaction) {
    async function insert(){
      var t0 = Date.now(); //used for time measurement
      while(pagination.hasNext){
        for(i=0; i<products.length; i++) {
          if(products[i].chosenStoreStock.stockLevelStatus == 'inStock') {
            var code = products[i].code
            var name = products[i].name
            var type = products[i].mainSubCategory.name
            var stockLevel = products[i].chosenStoreStock.stockLevel
            var price = products[i].price
            // console.log(type)
            transaction.run('INSERT OR IGNORE INTO '+tableName+' VALUES (?,?,?,?,?,?)', [code,name,type,price,69.0,stockLevel])
          }
        }
        const response = await pagination.next()
        products = response.products
        // products = products.concat(response.products)
        pagination = response.pagination
      }
      //END TRANSACTION
      transaction.commit(function(err) {
        if(err){
          console.log("Transaction failed: " + err.message)
        } else {
          var t1 = Date.now();
          console.log("Transaction successful! Took " + (t1 - t0) + " milliseconds.")
        }
      });
    }
    insert();
  });
  createOrUpdate(store,exists)
}

// check_store('Trondheim, Bankkvartalet')
// check_store('Trondheim, Valentinlyst')
// check_store('Malvik')
scraper.getRatingByName("Great Divide Yeti Imperial Stout").then(function(value) {
  console.log(value)
});
