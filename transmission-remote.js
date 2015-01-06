var tremote = {};

tremote.mods = {};

tremote.mods.transmission = require('transmission');
tremote.mods.nomnom = require('nomnom');
tremote.mods.cp = require('child_process');
tremote.mods.date_utils = require('date-utils');
tremote.mods.sprintf = require('sprintf');
tremote.mods.assign = Object.assign || require('object.assign');


tremote.units = {};
tremote.units.k = 1000;
tremote.units.kbytes = tremote.units.k;
tremote.units.mbytes = tremote.units.k * tremote.units.kbytes;
tremote.units.gbytes = tremote.units.k * tremote.units.mbytes;
tremote.units.formatSize = function(numbytes, format) {
  if (numbytes > tremote.units.gbytes) {
    return [tremote.mods.sprintf(format, (numbytes / tremote.units.gbytes)), "GB"].join(" ");
  }
  if (numbytes > tremote.units.mbytes) {
    return [tremote.mods.sprintf(format, (numbytes / tremote.units.mbytes)), "MB"].join(" ");
  }
  if (numbytes > tremote.units.kbytes) {
    return [tremote.mods.sprintf(format, (numbytes / tremote.units.kbytes)), "KB"].join(" ");
  }
};
tremote.units.humanSize = function(numbytes) {
  return tremote.units.formatSize(numbytes, "%6.2f");
};
tremote.units.compactSize = function(numbytes) {
  return tremote.units.formatSize(numbytes, "%3.0f");
};
tremote.units.humanSpeed = function(bps) {
  return tremote.mods.sprintf("%3f", (bps / 1000));
};

tremote.schema = function() {
  var self = {};

  self.colnames = [];
  self.coldefs = {};

  self.defaultcoldef = {
    show: true,
    sort: false,
    sorttype: 'N', // numeric
    align: "right",
  };
  
  self.defineColumn = function(colname, coldef) {
    self.colnames.push(colname);
    self.coldefs[colname] = Object.create(self.defaultcoldef);
    tremote.mods.assign(self.coldefs[colname], coldef || {});
  };
  
  return self;
}();



tremote.schema.defineColumn("id");   
tremote.schema.defineColumn("percentDone", {
  sort: true,
  humanview: function(ratio) {
    return tremote.mods.sprintf("%05.1f", 100.0 * ratio);       
  },
  compactview: function(ratio) {
    return tremote.mods.sprintf("%03.0f", 100.0 * ratio);       
  },
}); 
tremote.schema.defineColumn("haveValid", {
  compactview: tremote.units.compactSize,
  humanview: tremote.units.humanSize
}); 
tremote.schema.defineColumn('totalSize', {
  compactview: tremote.units.compactSize,
  humanview: tremote.units.humanSize
}); 
tremote.schema.defineColumn('eta', {
  humanview: function(eta, obj) {
    if (eta <= 0) { return "* Inf *"; }
    obj.etadate = Date.today().add({seconds: eta});
    obj.days = ("00" + Date.today().getDaysBetween(obj.etadate)).slice(-3);
    obj.eta = [obj.days,"d ",obj.etadate.toFormat("HH24h MIm")].join("");
    obj.eta = obj.eta.replace(/^000d\s*/, '');
    obj.eta = obj.eta.replace(/^00h\s*/, '');
    return obj.eta;
  },
}); 
tremote.schema.defineColumn('rateDownload', {humanview: tremote.units.humanSpeed} ); 
tremote.schema.defineColumn('rateUpload', {humanview: tremote.units.humanSpeed}); 
tremote.schema.defineColumn('name', {
  align: "left",
  humanview: function(name) {
    return name.replace(/([._])/g, '$1 ');
  },
}); 

module.exports = tremote.module = function() {
  var me = {};

  me.TransmissionRemote = function(spec) {
    var self = {};
    self.spec = spec || {};
    self.spec.eq = self.spec.eq || process;

    self.parser = new tremote.mods.nomnom();
    
    self.procs = {};

    self.spec.eq.on('parse', function(pSpec) {
      pSpec = pSpec || {};

      self.parser.option("host", {
        "abbr": "H",
        "position": 0,
        "default": "localhost",
      });
      self.parser.option("port", {
        "abbr": "P",
        "position": 1,
        "default": 9091
      });
      self.parser.option("auth", {
        "abbr": "n",
      });
      self.parser.option("WIDTH", {
        "abbr": "W",
        default: process.stdout.columns || 120,
      });
      self.parser.option("list", {
        "abbr": "l",
        "flag": true,
      });
      self.parser.option("reverse", {
        "flag": true,
        "list": true,
        default: [],
      });
      self.parser.option("column", {
        "list": true,
        "choices": tremote.schema.colnames,
        "default": tremote.schema.colnames.filter(function(x) { return tremote.schema.coldefs[x].show; }),
      });
      self.parser.option("sortby", {
        "list": true,
        "choices": tremote.schema.colnames,
        "default": tremote.schema.colnames.filter(function(x) { return tremote.schema.coldefs[x].sort; }),
      });
  
      pSpec.opts = self.parser.parse();
      console.error("PARSED: %j", pSpec);

      pSpec.clientSpec = {};
      pSpec.clientSpec.host = pSpec.opts.host;
      if (pSpec.opts.auth) {
        pSpec.opts.authParts = pSpec.opts.auth.split(/:/);
        pSpec.clientSpec.username = pSpec.opts.authParts[0];
        pSpec.clientSpec.password = pSpec.opts.authParts.slice(1).join(":");
      }
  
      pSpec.client = new tremote.mods.transmission(pSpec.clientSpec);

      if (pSpec.opts.list) {
        pSpec.client.get(function(err, arg) {
            
          if (err) {
            console.error('ERROR %j', err);
            return;
          }
            
          var lSpec = Object.create(pSpec);
          lSpec.torrents = arg.torrents;
          
          self.spec.eq.emit('list', lSpec);
        });
      }

    });

    self.spec.eq.on('list', function(lSpec) {
      self.procs.xmlify = tremote.mods.cp.spawn('bash', ['-c',
                                                         ['tee /tmp/tremote.xml',
                                                          'xmllint --format -',	 
                                                          ].join(" | ")]);
      self.procs.htmlify = tremote.mods.cp.spawn('xmlstarlet', ['sel',
                                                                '--template',
                                                                '--elem', 'table',
                                                                '--match', '//torrent',
                                                                ]
                                                 .concat(
                                                         lSpec.opts.sortby.reduce(function(accum, colname) {
                                                             var reversed = lSpec.opts.reverse[accum.ix] || false;
                                                             var coldef = tremote.schema.coldefs[colname];
                                                             var list = [
                                                                         '--sort',
                                                                         [(! coldef.descending) != (! reversed) ? "A" : "D",
                                                                          coldef.sorttype,
                                                                          'L'
                                                                          ].join(":"),
                                                                         tremote.mods.sprintf('./data/%s', colname),
                                                                         ];
                                                             
                                                             console.error("SORTLIST %j", {colname:colname, list:list, accum:accum});
                                                             return {ix:1+accum.ix,list:accum.list.concat(list)};
                                                           }, {ix:0, list:[]}).list
                                                         //'--sort', 'D:N:L', './data/percentDone',
                                                         //'--sort', 'A:T:L', './data/name',
                                                         //'--sort', 'A:N:L', './data/id',
                                                         )
                                                 .concat([
                                                          '--elem', 'tr'
                                                          ])
                                                 .concat(
                                                         /*
                                                           ["./data/id",
                                                           "./human/percentDone",
                                                           "./human/eta",
                                                           "./data/name"
                                                           ]
                                                         */
                                                         lSpec.opts.column.map(function(colname) {
                                                             var coldef = tremote.schema.coldefs[colname];
                                                             coldef.xpath = coldef.xpath || tremote.mods.sprintf('(./compact/%s|./data/%s|./human/%s)[1]', colname, colname, colname);
                                                             return coldef;
                                                           })
                                                         .reduce(function(accum, coldef) {
                                                             var list = [
                                                                         '--elem', 'td',
                                                                         '--attr', 'align',
                                                                         '--output', coldef.align,
                                                                         '--break',
                                                                         '--value-of', coldef.xpath,
                                                                         '--break',
                                                                         ];
                                                             return accum.concat(list);
                                                           }, [])));
      
      self.procs.tabfix = tremote.mods.cp.spawn('xmlstarlet', ['ed',
                                                               '-O',
                                                               '--insert', '//td', '--type', 'attr', '-n', 'valign', '--value', 'top',
                                                               //'--insert', '//td', '--type', 'attr', '-n', 'align', '--value', 'right'
                                                               ]);
      
      self.procs.txtify = tremote.mods.cp.spawn('bash', ['-c',
                                                         [
                                                          'tee /tmp/torrent.html',
                                                          ['html2text', '-width', lSpec.opts.WIDTH
                                                           ].join(" "),
                                                          'tee /tmp/torrent.txt'
                                                          ].join(" | ")]);
      
      self.procs.xmlify.stdout.pipe(self.procs.htmlify.stdin);
      self.procs.xmlify.stderr.pipe(process.stderr);
      
      self.procs.htmlify.stdout.pipe(self.procs.tabfix.stdin);
      self.procs.htmlify.stderr.pipe(process.stderr);

      self.procs.tabfix.stdout.pipe(self.procs.txtify.stdin);
      self.procs.tabfix.stderr.pipe(process.stderr);

      self.procs.txtify.stdout.pipe(process.stdout);
      self.procs.txtify.stderr.pipe(process.stderr);
  
  self.procs.xmlify.stdin.write("<root>\n");
  lSpec.torrents.forEach(function(torrent) {
    var data = {};
    var human = {};
    var compact = {};
    lSpec.opts.column.forEach(function(key) {
      var datakey = key;
      var coldef = tremote.schema.coldefs[key];
      if (coldef && coldef.datakey) {
	datakey = coldef.datakey;
      }
      data[datakey] = torrent[key];
      if (coldef && coldef.humanview && data[datakey]) {
	human[datakey] = coldef.humanview.call(null, data[datakey], human) || data[datakey];
      }
      if (coldef && coldef.compactview && data[datakey]) {
	if (lSpec.opts.WIDTH < 50) {
	  compact[datakey] = coldef.compactview.call(null, data[datakey], compact) || data[datakey];
	}
      }
    });
    
    self.procs.xmlify.stdin.write("<torrent>\n");
    self.procs.xmlify.stdin.write("<compact>\n");
    for (key in compact) {
      self.procs.xmlify.stdin.write("<" + key + ">");
      self.procs.xmlify.stdin.write(("" + compact[key]));
      self.procs.xmlify.stdin.write("</" + key + ">\n");	
    }
    self.procs.xmlify.stdin.write("</compact>\n");
    self.procs.xmlify.stdin.write("<human>\n");
    for (key in human) {
      self.procs.xmlify.stdin.write("<" + key + ">");
      self.procs.xmlify.stdin.write(("" + human[key]));
      self.procs.xmlify.stdin.write("</" + key + ">\n");	
    }
    self.procs.xmlify.stdin.write("</human>\n");
    self.procs.xmlify.stdin.write("<data>\n");
    for (key in data) {
      self.procs.xmlify.stdin.write("<" + key + ">");
      self.procs.xmlify.stdin.write(("" + data[key]).trim());
      self.procs.xmlify.stdin.write("</" + key + ">\n");	
    }
    self.procs.xmlify.stdin.write("</data>\n");
    self.procs.xmlify.stdin.write("</torrent>\n");
  });
  self.procs.xmlify.stdin.write("</root>\n");
  self.procs.xmlify.stdin.end();
    });
    
    return self;
  };
  
  return me;  
}();

tremote.parser = new tremote.mods.nomnom();

//self.procs = {};

process.on('list', function(lSpec) {    
});

//process.emit('parse');

if (module.parent) {
} else {
  var tr = new tremote.module.TransmissionRemote({eq:process});
  process.emit('parse');
}
