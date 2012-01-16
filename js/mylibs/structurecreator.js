(function(window) {
	
	var StructureCreator = {
		zip : null,
		schema_file : null,
		total_folders : 0,
		folders_checked : 0,
		total_files : 0,
		files_checked : 0,

		//Start The creation of the files
		start : function() {
			StructureCreator.zip             = new JSZip();
			StructureCreator.total_folders   = 0;
			StructureCreator.total_files     = 0;
			StructureCreator.folders_checked = 0;
			StructureCreator.files_checked   = 0;

			if (StructureCreator.schema_file.type === "text/xml") {
				var reader = new FileReader();
				reader.onload = (function(file){
					return function(e) {
						var xml = StructureCreator.xml.str2xml(e.target.result);
						StructureCreator.total_folders = xml.getElementsByTagName('folder').length;
						StructureCreator.total_files   = xml.getElementsByTagName('file').length;
						StructureCreator.folderLoop(xml, StructureCreator.zip);
					};
				})(StructureCreator.schema_file);
				reader.readAsText(StructureCreator.schema_file);
			}
		},
		
		folderLoop : function (xml, folder) {
			var node, i, file, new_folder;
			for (i = xml.childNodes.length - 1; i >= 0; i--) {

				node = xml.childNodes[i];
				if (node.nodeName === "folder") {

					new_folder = folder.folder(node.getAttribute('name'));
					//create folder in zip.
					StructureCreator.folderLoop(node, new_folder);

				} else if (node.nodeName === "file") {
					
					if (node.firstChild) {
						log(node.firstChild.data);
						folder.add(node.getAttribute('name'), node.firstChild.data);
						StructureCreator.files_checked += 1;
					} else {
						//TODO Get data from url attribute
						var f = StructureCreator.fileLoader(folder, node);
						
						//folder.add(node.getAttribute('name'), "Hello World\n");
					}

				}
			};
			StructureCreator.folders_checked += 1;
			//Check if complete
			if (StructureCreator.isCompleted()) {
				log(StructureCreator.zip);
				StructureCreator.saveZip();
			}
		},

		fileLoader : function (folder, node) {
			/*var client = new XMLHttpRequest();
			client.open('GET', node.getAttribute('url'));
			client.onreadystatechange = function() {
				//alert(client.responseText);
				folder.add(node.getAttribute('name'), client.responseText);
				StructureCreator.files_checked += 1;
				//Check if complete
				if (StructureCreator.isCompleted()) {
					log(StructureCreator.zip);
					StructureCreator.saveZip();
				}
			}
			client.send();*/

			var xhr = new XMLHttpRequest();
			xhr.open("GET", node.getAttribute('url'), true);
			xhr.onreadystatechange = function(){
			  if ( xhr.readyState == 4 ) {
			    if ( xhr.status == 200 ) {
			      //document.body.innerHTML = "My Name is: " + xhr.responseText;
			      log(xhr.responseText);
			    } else {
			      //document.body.innerHTML = "ERROR";
			      log("Error loading from " + node.getAttribute('url'));
			    }
			  }
			};
			xhr.send(null);

			/*$.get(node.getAttribute('url'), function(response, status, xhr) {
				log(response);
			});*/

			/*var o = document.createElement('osloader');
			$(o).load(node.getAttribute('url'), function (response, status, xhr){
				log(response);
			});*/
		},

		isCompleted : function () {
			if ((StructureCreator.folders_checked === StructureCreator.total_folders)
					&& (StructureCreator.files_checked === StructureCreator.total_files)) {
				return true;
			} else {
				return false;
			}
		},

		//Saves all the files as a zip file
		saveZip : function() {
			content = StructureCreator.zip.generate();
			location.href="data:application/zip;base64,"+content;
		}
	}

	window.StructureCreator = window.SC = StructureCreator;
})(window);