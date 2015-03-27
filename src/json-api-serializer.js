var get = Ember.get;
var isNone = Ember.isNone;
var HOST = /(^https?:\/\/.*?)(\/.*)/;

DS.JsonApiSerializer = DS.RESTSerializer.extend({

  primaryRecordKey: 'data',
  sideloadedRecordsKey: 'included',
  relationshipKey: 'self',
  relatedResourceKey: 'related',

  keyForRelationship: function(key) {
    return key;
  },

  /**
   * Flatten links
   */
  normalize: function(type, hash, prop) {
    var json = {};
    for (var key in hash) {
      // This is already normalized
      if (key === 'links') {
        json[key] = hash[key];
        continue;
      }

      var camelizedKey = Ember.String.camelize(key);
      json[camelizedKey] = hash[key];
    }

    return this._super(type, json, prop);
  },

  /**
   * Extract top-level "meta" & "links" before normalizing.
   */
  normalizePayload: function(payload) {
    if(!payload) { return {}; }
    var data = payload[this.primaryRecordKey];
    if (data) {
      if(Ember.isArray(data)) {
        this.extractArrayData(data, payload);
      } else {
        this.extractSingleData(data, payload);
      }
      delete payload[this.primaryRecordKey];
    }
    if (payload.meta) {
      this.extractMeta(payload.meta);
      delete payload.meta;
    }
    if (payload.links) {
      // FIXME Need to handle top level links, like pagination
      //this.extractRelationships(payload.links, payload);
      delete payload.links;
    }
    if (payload[this.sideloadedRecordsKey]) {
      this.extractSideloaded(payload[this.sideloadedRecordsKey]);
      delete payload[this.sideloadedRecordsKey];
    }

    return payload;
  },

  extractArray: function(store, type, arrayPayload, id, requestType) {
    if(Ember.isEmpty(arrayPayload[this.primaryRecordKey])) { return Ember.A(); }
    return this._super(store, type, arrayPayload, id, requestType);
  },

  /**
   * Extract top-level "data" containing a single primary data
   */
  extractSingleData: function(data, payload) {
    if(data.links) {
      this.extractRelationships(data.links, data);
      //delete data.links;
    }
    payload[data.type] = data;
    delete data.type;
  },

  /**
   * Extract top-level "data" containing a single primary data
   */
  extractArrayData: function(data, payload) {
    var type = data.length > 0 ? data[0].type : null, serializer = this;
    data.forEach(function(item) {
      if(item.links) {
        serializer.extractRelationships(item.links, item);
        //delete data.links;
      }
    });

    payload[type] = data;
  },

  /**
   * Extract top-level "included" containing associated objects
   */
  extractSideloaded: function(sideloaded) {
    var store = get(this, 'store'), models = {}, serializer = this;

    sideloaded.forEach(function(link) {
      var type = link.type;
      if(link.links) {
        serializer.extractRelationships(link.links, link);
      }
      delete link.type;
      if(!models[type]) {
        models[type] = [];
      }
      models[type].push(link);
    });

    this.pushPayload(store, models);
  },

  /**
   * Parse the top-level "links" object.
   */
  extractRelationships: function(links, resource) {
    var link, association, id, route, relationshipLink, cleanedRoute, linkKey;

    // Clear the old format
    resource.links = {};

    for (link in links) {
      association = links[link];
      link = Ember.String.camelize(link.split('.').pop());
      if(!association) { continue; }
      if (typeof association === 'string') {
        if (association.indexOf('/') > -1) {
          route = association;
          id = null;
        } else { // This is no longer valid in JSON API. Potentially remove.
          route = null;
          id = association;
        }
        relationshipLink = null;
      } else {
        relationshipLink =  association[this.relationshipKey];
        route = association[this.relatedResourceKey];
        id = getLinkageId(association.linkage);
      }

      if (route) {
        cleanedRoute = this.removeHost(route);
        resource.links[link] = cleanedRoute;

        // Need clarification on how this is used
        if(cleanedRoute.indexOf('{') > -1) {
          DS._routes[link] = cleanedRoute.replace(/^\//, '');
        }
      }
      if(id) {
        resource[link] = id;
      }
      if(relationshipLink) {
        resource.links[link + '--self'] = this.removeHost(relationshipLink);
      }
    }
    return resource.links;
  },

  removeHost: function(url) {
    return url.replace(HOST, '$2');
  },

  // SERIALIZATION

  serializeIntoHash: function(hash, type, snapshot, options) {
    var pluralType = Ember.String.pluralize(type.typeKey),
      data = this.serialize(snapshot, options);
    if(!data.hasOwnProperty('type')) {
      data.type = pluralType;
    }
    hash[type.typeKey] = data;
  },

  /**
   * Use "links" key, remove support for polymorphic type
   */
  serializeBelongsTo: function(record, json, relationship) {
    var attr = relationship.key;
    var belongsTo = record.belongsTo(attr);
    var type = this.keyForRelationship(relationship.type.typeKey);
    var key = this.keyForRelationship(attr);

    if (isNone(belongsTo)) return;

    json.links = json.links || {};
    json.links[key] = belongsToLink(key, type, get(belongsTo, 'id'));
  },

  /**
   * Use "links" key
   */
  serializeHasMany: function(record, json, relationship) {
    var attr = relationship.key,
      type = this.keyForRelationship(relationship.type.typeKey),
      key = this.keyForRelationship(attr);

    if (relationship.kind === 'hasMany') {
      json.links = json.links || {};
      json.links[key] = hasManyLink(key, type, record, attr);
    }
  }
});

function belongsToLink(key, type, id) {
  if(!id) { return {}; }

  return {
    linkage: {
      id: id,
      type: Ember.String.pluralize(type)
    }
  };
}

function hasManyLink(key, type, record, attr) {
  var links = record.hasMany(attr).mapBy('id') || [],
    typeName = Ember.String.pluralize(type),
    linkages = [], index, total;

  for(index=0, total=links.length; index<total; ++index) {
    linkages.push({
      id: links[index],
      type: typeName
    });
  }

  return { linkage: linkages };
}

function getIdObject(linkage) {
  if (linkage.id && linkage.type) {
    return {
      id: linkage.id,
      type: Ember.String.camelize(linkage.type.singularize())
    };
  } else {
    return linkage.id;
  }
}
function getLinkageId(linkage) {
  if(Ember.isEmpty(linkage)) { return null; }
  return (Ember.isArray(linkage)) ? getLinkageIds(linkage) : getIdObject(linkage);
}
function getLinkageIds(linkage) {
  if(Ember.isEmpty(linkage)) { return null; }
  var ids = [], index, total;
  for(index=0, total=linkage.length; index<total; ++index) {
    ids.push(getIdObject(linkage[index]));
  }
  return ids;
}

export default DS.JsonApiSerializer;
