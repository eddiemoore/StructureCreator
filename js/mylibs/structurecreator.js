(function (window) {

	//private vars
	var _total_folders   = 0,
		_total_files     = 0,
		_folders_created = 0,
		_files_created   = 0;

	//public vars
	
	
	var StructureCreator = function () {
		//this.schema_file = null;
	};

	//StructureCreator.prototype = {};
	StructureCreator.schema_file = null;
	StructureCreator.zip = null;

	StructureCreator.prototype.init = function() {
		_total_files     = 0;
		_total_folders   = 0;
		_folders_created = 0;
		_files_created   = 0;

		this.loadSchemaFile();
	};

	StructureCreator.prototype.loadSchemaFile = function () {
		log(this);
		if (StructureCreator.schema_file !== null) {
			if (typeof StructureCreator.schema_file === "string") {
				var ext = StructureCreator.schema_file.substr(StructureCreator.schema_file.lastIndexOf('.') + 1);
				ext = ext.toLowerCase();

				if (typeof this.schemas[ext] !== "undefined") {
					log('load the file');
					this.net.URLLoader(this.schema_file, "GET", null, this.schemas[ext].init);
				} else {
					console.log('There is nothing to open a ' + ext + ' file with. :(');
				}

			} else {
				//TODO load schema using File Reference
				console.log('schema is a file on the computer so use FileReader');
				if (StructureCreator.schema_file.type === "text/xml") {
					log(this.schemas);
					this.schemas.xml.readXMLFromFile();
				} else {
					console.error("Cannot read schema file");
				}
			}
		} else {
			//TODO dispatch event that schema is not created.
			console.log('no schema file to load');
		}
	};

	StructureCreator.prototype.isCompleted = function() {
		if (_folders_created === _total_folders && _files_created === _total_files) {
			return true;
		}
		return false;
	};
	




	//Schema types
	StructureCreator.prototype.schemas = {
		//XML
		xml : {
			init : function (response) {
				log('load the xml');
				log(response);
				var xml = StructureCreator.schemas.xml.str2xml(result);
				_total_folders = xml.getElementsByTagName('folder').length;
				_total_files   = xml.getElementsByTagName('file').length;
				StructureCreator.schemas.xml.folderLoop(xml.childNodes[0], null);
			},

			readXMLFromFile : function () {
				log('read xml from file');
				var reader = new FileReader();
				reader.onload = (function(file){
					log('file loaded');
					//return function(e) {
						/*var xml = StructureCreator.schemas.xml.str2xml(e.target.result);
						_total_folders = xml.getElementsByTagName('folder').length;
						_total_files   = xml.getElementsByTagName('file').length;
						StructureCreator.schemas.xml.folderLoop(xml.childNodes[0], null);*/
					//StructureCreator.schemas.xml.init()
					log(file.target.result);
					StructureCreator.schemas.xml.init(e.target.result);
						//StructureCreator.folderLoop(xml, StructureCreator.zip);
					//};
				})(StructureCreator.schema_file);
				log(StructureCreator.schema_file);
				reader.readAsText(StructureCreator.schema_file);
			},

			folderLoop : function (xml, folder) {
				var node, i, file, new_folder;
				for (i = xml.childNodes.length - 1; i >= 0; i--) {

					node = xml.childNodes[i];
					if (node.nodeName === "folder") {
						log('create folder : ' + node.getAttribute('name'));
						new_folder = null;//folder.folder(node.getAttribute('name'));
						//create folder in zip.
						StructureCreator.schemas.xml.folderLoop(node, new_folder);
						
					} else if (node.nodeName === "file") {
						
						if (node.firstChild) {
							log('create file : ' + node.getAttribute('name'));
							log(node.firstChild.data);
							//folder.add(node.getAttribute('name'), node.firstChild.data);
							_files_created += 1;
						} else {
							//TODO Get data from url attribute
							//var f = StructureCreator.fileLoader(folder, node);
							
							//folder.add(node.getAttribute('name'), "Hello World\n");
						}

					}
				};
				_folders_created += 1;
				//Check if complete
				if (StructureCreator.isCompleted()) {
					log('all files and folders created');
					//log(StructureCreator.zip);
					//StructureCreator.saveZip();
				}
			},

			str2xml : function (str) {
				var doc;
				if (window.ActiveXObject) { 
					doc = new ActiveXObject("Microsoft.XMLDOM"); 
					doc.async = "false"; 
					doc.loadXML(strXML); 
				} else { 
					// code for Mozilla, Firefox, Opera, etc. 
					var parser = new DOMParser();
					doc = parser.parseFromString(strXML,"text/xml"); 
				}// documentElement always represents the root node 
				return doc;
			}
		}
	};




	//StructureCreator.net functions
	StructureCreator.prototype.net = function() {
		this.URLLoader = function (url, method, params, callback) {
			var xhr = new XMLHttpRequest(),
				method = method || "GET",
				params = params || null,
				callback = callback || function (response) {};

			xhr.onreadystatechange = function(){
			  if ( xhr.readyState == 4 ) {
			    if ( xhr.status == 200 ) {
					console.log(xhr.responseText);
					callback(xhr.responseText);
			    } else {
			    	console.log("Error loading from " + url);
			    }
			  }
			};
			xhr.open(method, url, true);
			xhr.send(params);
		}
	};

	//Expose StructureCreator to the global object
	window.StructureCreator = StructureCreator;

}(window));