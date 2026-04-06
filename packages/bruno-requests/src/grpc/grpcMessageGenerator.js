import { faker } from '@faker-js/faker';

/**
 * Generates a sample message based on method parameter fields
 * @param {Object} fields - Method parameter fields (protobufjs field descriptors)
 * @param {Object} options - Generation options
 * @param {Object} root - protobufjs Root object for looking up nested types
 * @returns {Object} Generated message
 */
const generateSampleMessageFromFields = (fields, options = {}, root = null) => {
  const result = {};

  if (!fields || !Array.isArray(fields)) {
    return {};
  }

  fields.forEach((field) => {
    if (!field || typeof field.name !== 'string') {
      return;
    }

    const isRepeated = field.repeated === true || field.repeated === 'repeated' || field.rule === 'repeated' || field.map;

    // Debug logging - remove in production
    console.log('Field:', JSON.stringify(field));
    console.log('isRepeated:', isRepeated);

    const fieldType = getFieldType(field.type, field);

    // Generate a value based on field name and type
    if (fieldType === 'TYPE_MESSAGE') {
      // Handle nested message
      const messageFields = getMessageType(field, root);
      if (messageFields && messageFields.field) {
        if (isRepeated) {
          // Generate array of nested messages
          const count = options.arraySize || faker.number.int({ min: 1, max: 3 });
          result[field.name] = Array.from({ length: count }, () =>
            generateSampleMessageFromFields(messageFields.field, options, root)
          );
        } else {
          // Generate single nested message
          result[field.name] = generateSampleMessageFromFields(messageFields.field, options, root);
        }
      } else {
        // No field info for nested message, generate a simple object
        result[field.name] = isRepeated ? [{}] : {};
      }
    } else if (fieldType === 'TYPE_ENUM') {
      result[field.name] = isRepeated ? [0] : 0;
    } else {
      // Generate value based on primitive type and name
      let value;

      // Handle both uppercase (legacy) and lowercase (protobufjs) type names
      const typeUpper = field.type?.toUpperCase();
      switch (typeUpper) {
        case 'DOUBLE':
        case 'FLOAT':
          value = faker.number.float({ min: 0, max: 1000, precision: 0.01 });
          break;
        case 'INT32':
        case 'INT64':
        case 'SINT32':
        case 'SINT64':
        case 'UINT32':
        case 'UINT64':
        case 'FIXED32':
        case 'FIXED64':
        case 'SFIXED32':
        case 'SFIXED64':
        case 'SLIMITED':
        case 'LIMITED':
          value = faker.number.int({ min: 0, max: 1000 });
          break;
        case 'BOOL':
          value = faker.datatype.boolean();
          break;
        case 'STRING':
          value = faker.lorem.word();
          break;
        case 'BYTES':
          value = Buffer.from(faker.string.alpha({ length: { min: 5, max: 10 } })).toString('base64');
          break;
        default:
          value = faker.lorem.word();
      }

      if (isRepeated) {
        // Generate array of values
        const count = options.arraySize || faker.number.int({ min: 1, max: 3 });
        result[field.name] = Array.from({ length: count }, () => value);
      } else {
        result[field.name] = value;
      }
    }
  });

  return result;
};

/**
 * Extracts field definitions from a method's request type
 * @param {Object} method - The gRPC method
 * @returns {Array|null} Array of field definitions or null
 */
const getMethodRequestFields = (method) => {
  const requestType = method?.requestType;
  if (!requestType) {
    return null;
  }

  // protobufjs Type: requestType.fieldsArray (getter)
  if (Array.isArray(requestType.fieldsArray)) {
    return requestType.fieldsArray;
  }

  // Handle serialized protobufjs Type (after JSON parse)
  // The getter is lost, but we have _fieldsArray or fields
  if (Array.isArray(requestType._fieldsArray)) {
    return requestType._fieldsArray.filter((f) => f && typeof f.name === 'string');
  }

  // Handle Type with fields object where field names are keys and fields don't have name property
  // e.g., { name: { type: 'string', id: 1 }, messages: { rule: 'repeated', type: '.helloworld.SomeMessage', id: 2 } }
  if (requestType.fields && typeof requestType.fields === 'object') {
    const fieldEntries = Object.entries(requestType.fields);
    // Check if fields have a name property (protobufjs format)
    if (fieldEntries.length > 0 && fieldEntries[0][1]?.name) {
      return Object.values(requestType.fields).filter((f) => f && typeof f.name === 'string');
    }
    // Fields don't have name property, derive it from the object key
    if (fieldEntries.length > 0 && !fieldEntries[0][1]?.name) {
      return fieldEntries.map(([fieldName, fieldDef]) => ({
        ...fieldDef,
        name: fieldName
      }));
    }
  }

  // Wrapped format: requestType.type.fieldsArray
  if (requestType.type?.fieldsArray) {
    return requestType.type.fieldsArray;
  }

  // Handle serialized wrapped format
  if (requestType.type?._fieldsArray) {
    return requestType.type._fieldsArray.filter((f) => f && typeof f.name === 'string');
  }

  if (requestType.type?.fields && typeof requestType.type.fields === 'object') {
    const fieldEntries = Object.entries(requestType.type.fields);
    if (fieldEntries.length > 0 && fieldEntries[0][1]?.name) {
      return Object.values(requestType.type.fields).filter((f) => f && typeof f.name === 'string');
    }
    if (fieldEntries.length > 0 && !fieldEntries[0][1]?.name) {
      return fieldEntries.map(([fieldName, fieldDef]) => ({
        ...fieldDef,
        name: fieldName
      }));
    }
  }

  // Legacy wrapped format: requestType.type.field
  if (Array.isArray(requestType.type?.field)) {
    return requestType.type.field;
  }

  // Legacy format: requestType.field
  if (Array.isArray(requestType.field)) {
    return requestType.field;
  }

  return null;
};

/**
 * Converts protobufjs field type to TYPE_MESSAGE/TYPE_ENUM constants
 * @param {string} type - protobufjs field type (e.g., 'message', 'enum', 'string', '.package.Message')
 * @param {Object} field - The protobufjs field descriptor
 * @returns {string} Bruno's expected type format
 */
const getFieldType = (type, field) => {
  // Check for fully qualified type names (e.g., '.helloworld.SomeMessage')
  // These start with '.' and contain another '.', indicating a package path
  if (type && type.startsWith('.')) {
    return 'TYPE_MESSAGE';
  }

  // Check for short type names that indicate message/enum
  if (type === 'message' || type === 'group') {
    return 'TYPE_MESSAGE';
  }
  if (type === 'enum') {
    return 'TYPE_ENUM';
  }

  // Handle primitive types
  return type?.toUpperCase() || 'TYPE_MESSAGE';
};

/**
 * Gets the message type from a protobufjs field
 * @param {Object} field - The protobufjs field descriptor
 * @param {Object} root - protobufjs Root object for looking up nested types
 * @returns {Object|null} Message type object or null
 */
const getMessageType = (field, root = null) => {
  // First try resolvedType if available
  if (field.resolvedType) {
    // Handle protobufjs Type with fieldsArray getter
    if (Array.isArray(field.resolvedType.fieldsArray)) {
      return { field: field.resolvedType.fieldsArray };
    }
    // Handle serialized Type with _fieldsArray
    if (Array.isArray(field.resolvedType._fieldsArray)) {
      return { field: field.resolvedType._fieldsArray };
    }
    // Handle Type with fields object
    if (field.resolvedType.fields && typeof field.resolvedType.fields === 'object') {
      // Check if fields have name property
      const entries = Object.entries(field.resolvedType.fields);
      if (entries.length > 0 && entries[0][1]?.name) {
        return { field: Object.values(field.resolvedType.fields) };
      }
      // Derive name from object key
      if (entries.length > 0 && !entries[0][1]?.name) {
        return { field: entries.map(([fieldName, fieldDef]) => ({ ...fieldDef, name: fieldName })) };
      }
    }
  }

  // Try to look up the type from root if we have a fully qualified type name
  if (root && field.type && field.type.startsWith('.')) {
    try {
      // Check if root has lookupType method (protobufjs Root)
      if (typeof root.lookupType === 'function') {
        const resolvedType = root.lookupType(field.type);
        if (resolvedType) {
          // Handle protobufjs Type with fieldsArray getter
          if (Array.isArray(resolvedType.fieldsArray)) {
            return { field: resolvedType.fieldsArray };
          }
          // Handle serialized Type
          if (resolvedType.fields && typeof resolvedType.fields === 'object') {
            const entries = Object.entries(resolvedType.fields);
            if (entries.length > 0 && entries[0][1]?.name) {
              return { field: Object.values(resolvedType.fields) };
            }
            if (entries.length > 0 && !entries[0][1]?.name) {
              return { field: entries.map(([fieldName, fieldDef]) => ({ ...fieldDef, name: fieldName })) };
            }
          }
          if (Array.isArray(resolvedType._fieldsArray)) {
            return { field: resolvedType._fieldsArray };
          }
        }
      } else if (root.nested && typeof root.nested === 'object') {
        // Handle serialized Root - navigate to find the type
        // Type might be like '.helloworld.SomeMessage'
        const typePath = field.type.replace(/^\./, '').split('.');
        let current = root.nested;

        for (const part of typePath) {
          if (current && current[part]) {
            current = current[part];
            // If we found nested at this level, continue
            if (current.nested) {
              current = current.nested;
            }
          } else {
            current = null;
            break;
          }
        }

        // current should now be the Type object with fields
        if (current && current.fields) {
          const entries = Object.entries(current.fields);
          if (entries.length > 0 && entries[0][1]?.name) {
            return { field: Object.values(current.fields) };
          }
          if (entries.length > 0 && !entries[0][1]?.name) {
            return { field: entries.map(([fieldName, fieldDef]) => ({ ...fieldDef, name: fieldName })) };
          }
        }
      }
    } catch (e) {
      // Type lookup failed, return null
    }
  }

  return null;
};

/**
 * Generates a sample gRPC message based on a method definition
 * @param {Object} method - gRPC method definition
 * @param {Object} options - Generation options
 * @returns {Object} Generated message
 */
export const generateGrpcSampleMessage = (method, options = {}) => {
  try {
    if (!method) {
      return {};
    }

    const fields = getMethodRequestFields(method);
    const root = method?.root || null;

    if (fields) {
      return generateSampleMessageFromFields(fields, options, root);
    }

    // If method exists but no field information could be extracted,
    // generate a generic message that matches common patterns
    return {};
  } catch (error) {
    console.error('Error generating gRPC sample message:', error);
  }
};
