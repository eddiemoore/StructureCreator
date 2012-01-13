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
			StructureCreator.zip = new JSZip();
			StructureCreator.total_folders = 0;

			if (StructureCreator.schema_file.type === "text/xml") {
				var reader = new FileReader();
				reader.onload = (function(file){
					return function(e) {
						var xml = StructureCreator.xml.str2xml(e.target.result);
						StructureCreator.total_folders = xml.getElementsByTagName('folder').length;
						StructureCreator.total_files = xml.getElementsByTagName('file').length;
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
					log(node.textContent);

					folder.add(node.getAttribute('name'), "Hello World\n");
				}
			};
			StructureCreator.folders_checked += 1;
			if (StructureCreator.folders_checked === StructureCreator.total_folders) {
				log(StructureCreator.zip);
				//StructureCreator.saveZip();
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