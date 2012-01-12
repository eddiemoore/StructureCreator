/* Author: 

*/


$(function() {
	
	//$('#schema-file').change()
});


var schema_file;


function schemaFileSelect(evt) {
	schema_file = evt.target.files[0]; // File
	log(schema_file);
}

function startCreating() {

	//Read Schema file
	if (schema_file.type === "text/xml") {
		var reader = new FileReader();
		reader.onload = (function(file){
			return function(e) {
	          //var span = document.createElement('span');
	          //log(e.target);
	          //log(e.target.result);
	          var xml = StructureCreator.xml.str2xml(e.target.result);
	          folderLoop(xml);
	          //document.getElementById('list').insertBefore(span, null);
	        };
		})(schema_file);
		reader.readAsText(schema_file);
	}
}

function folderLoop(xml) {
	log(xml);
	var node;
	for (var i = xml.childNodes.length - 1; i >= 0; i--) {
		var node = xml.childNodes[i];
		if (node.nodeName === "folder") {
			log("it's a folder");
			//create folder in zip.
			folderLoop(node);
		} else if (node.nodeName === "file") {
			log("it's a file");
		}
	};
}

document.getElementById('schema_file').addEventListener('change', schemaFileSelect, false);
document.getElementById('create_project').addEventListener('click', startCreating, false);
















