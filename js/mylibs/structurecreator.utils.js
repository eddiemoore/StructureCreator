(function() {
	
	if (StructureCreator !== undefined) {
		
		StructureCreator.xml = { 
			str2xml : function(strXML) { 
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
			}, 

			xml2string : function(xmlDom){ 
				var strs = null,
					doc = xmlDom.documentElement; 
				if(doc.xml === undefined){ 
					strs = (new XMLSerializer()).serializeToString(xmlDom); 
				} else strs = doc.xml; 
				return strs;
			} 
		} 

	} else {
		console.log('StructureCreator not loaded');
	}

})();